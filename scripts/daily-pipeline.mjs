#!/usr/bin/env node
/**
 * scripts/daily-pipeline.mjs — Career-Ops India Daily Job Hunt Pipeline
 * 
 * Orchestrates the full daily workflow:
 * 1. Scans portal boards & registers live jobs into data/scan_results.json
 * 2. Identifies and selects top unevaluated candidates (Official ATS > Aggregators)
 * 3. Evaluates selected batches using cached AI evaluations & live model fallback
 * 4. Rebuilds the curated queue respecting user application state & 5/company cap
 * 5. Exposes execution locks, live progress tracking, and metrics
 * 
 * Run CLI:  npm run daily
 * Run CLI:  node scripts/daily-pipeline.mjs
 * Run CLI:  node scripts/daily-pipeline.mjs --dry-run
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { runScan } from "./scan.mjs";
import { evaluateBatch, loadCache } from "./ai/evaluator.mjs";
import { partitionQueue } from "./queue-core.mjs";
import { loadApplicationState, filterJobsByState } from "./state-service.mjs";
import {
  loadJobLifecycleState,
  filterJobsByLifecycle,
  reconcileJobLifecycle
} from "./job-lifecycle-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PROFILE_PATH = path.join(ROOT, "config/profile.yml");

export const LOCK_FILE = path.join(DATA_DIR, "daily-pipeline.lock");
export const STATUS_FILE = path.join(DATA_DIR, ".daily-pipeline-status.json");
export const SCAN_RESULTS_FILE = path.join(DATA_DIR, "scan_results.json");

// In-memory status tracker
let inMemoryStatus = {
  status: "idle",
  phase: null,
  started_at: null,
  completed_at: null,
  scan: { companies: 0, eligible_jobs: 0 },
  evaluation: {
    official_selected: 0,
    official_evaluated: 0,
    official_cached: 0,
    aggregator_selected: 0,
    aggregator_evaluated: 0,
    aggregator_cached: 0,
    ai_calls_made: 0,
    cached_reused: 0
  },
  queue: { apply: 0, consider: 0, new: 0 },
  errors: []
};

/**
 * Returns current status of the daily pipeline.
 */
export function getPipelineStatus() {
  if (fs.existsSync(STATUS_FILE)) {
    try {
      const diskStatus = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
      return { ...diskStatus, is_locked: fs.existsSync(LOCK_FILE) };
    } catch {}
  }
  return { ...inMemoryStatus, is_locked: fs.existsSync(LOCK_FILE) };
}

/**
 * Updates status both in-memory and on disk atomically.
 */
function updateStatus(partial) {
  inMemoryStatus = {
    ...inMemoryStatus,
    ...partial,
    scan: { ...inMemoryStatus.scan, ...(partial.scan || {}) },
    evaluation: { ...inMemoryStatus.evaluation, ...(partial.evaluation || {}) },
    queue: { ...inMemoryStatus.queue, ...(partial.queue || {}) },
    errors: partial.errors || inMemoryStatus.errors
  };

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = `${STATUS_FILE}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(inMemoryStatus, null, 2), "utf8");
    fs.renameSync(tempFile, STATUS_FILE);
  } catch {}
  return inMemoryStatus;
}

/**
 * Checks if a pipeline lock is active, handling stale lock cleanup.
 */
export function isPipelineRunning(maxLockAgeMs = 15 * 60 * 1000) {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const raw = fs.readFileSync(LOCK_FILE, "utf8");
    const data = JSON.parse(raw);

    // Check if process is still alive
    if (data.pid) {
      try {
        process.kill(data.pid, 0);
      } catch (err) {
        if (err.code === "ESRCH") {
          releaseLock();
          return false;
        }
      }
    }

    const lockTime = Date.parse(data.started_at || "");
    if (Number.isFinite(lockTime) && Date.now() - lockTime > maxLockAgeMs) {
      console.warn(`⚠️ Stale pipeline lock detected (>15m old). Releasing lock automatically.`);
      releaseLock();
      return false;
    }
    return true;
  } catch {
    releaseLock();
    return false;
  }
}

/**
 * Acquires lock for daily pipeline execution.
 */
export function acquireLock() {
  if (isPipelineRunning()) {
    const current = getPipelineStatus();
    throw new Error(`Daily pipeline is already running (started at ${current.started_at || "unknown"}).`);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lockData = {
    pid: process.pid,
    started_at: new Date().toISOString()
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2), "utf8");
}

/**
 * Releases lock upon completion or error.
 */
export function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

/**
 * Runs the complete Daily Job Hunt Pipeline with deterministic safety.
 */
export async function runDailyPipeline(options = {}) {
  const silent = options.silent ?? false;
  const dryRun = Boolean(options.dryRun || options["dry-run"]);
  let employerAtsLimit = options.employerAtsLimit;
  let aggregatorLimit = options.aggregatorLimit;
  if (employerAtsLimit == null) {
    try {
      if (fs.existsSync(PROFILE_PATH)) {
        const profile = yaml.load(fs.readFileSync(PROFILE_PATH, "utf8")) || {};
        if (profile.evaluator?.max_evals != null) employerAtsLimit = Number(profile.evaluator.max_evals);
      }
    } catch {}
  }
  employerAtsLimit = Number.isFinite(employerAtsLimit) ? employerAtsLimit : 200;
  aggregatorLimit = Number.isFinite(aggregatorLimit) ? aggregatorLimit : 50;
  const concurrency = typeof options.concurrency === "number" ? options.concurrency : 3;
  const force = Boolean(options.force);
  const scanResultsPath = options.scanResultsPath || SCAN_RESULTS_FILE;
  const cachePath = options.cachePath || path.join(DATA_DIR, ".ai_cache.json");

  // 1. Acquire Lock
  acquireLock();

  const startedAt = new Date().toISOString();
  updateStatus({
    status: "running",
    phase: "scanning",
    started_at: startedAt,
    completed_at: null,
    errors: []
  });

  if (!silent) {
    console.log(`\n${"═".repeat(72)}`);
    console.log(`🚀 CAREER-OPS INDIA — DAILY JOB HUNT PIPELINE`);
    console.log(`${"═".repeat(72)}`);
    console.log(`Started at: ${new Date(startedAt).toLocaleString()}`);
    console.log(`Budgets: ${employerAtsLimit} Official ATS jobs | ${aggregatorLimit} Discovery jobs`);
    if (dryRun) console.log(`Mode: DRY RUN (Mock AI Synthesizer, 0 credits)\n`);
    else console.log(`Mode: LIVE EVALUATOR\n`);
  }

  const errors = [];
  let scanStats = { companies: 0, eligible_jobs: 0 };
  let evalStats = {
    official_selected: 0,
    official_evaluated: 0,
    official_cached: 0,
    aggregator_selected: 0,
    aggregator_evaluated: 0,
    aggregator_cached: 0,
    ai_calls_made: 0,
    cached_reused: 0
  };

  try {
    // ── STEP 1: SCAN ────────────────────────────────────────────────────────
    if (!silent) console.log(`▶ Step 1/4: Scanning company portal boards...`);
    
    let scanRes;
    if (options.skipScan) {
      if (!fs.existsSync(scanResultsPath)) {
        throw new Error(`Scan results file not found at ${scanResultsPath}`);
      }
      const data = JSON.parse(fs.readFileSync(scanResultsPath, "utf8"));
      scanRes = { total: data.total || (data.jobs || []).length, totalCompanies: 65, jobs: data.jobs || [] };
    } else {
      scanRes = await runScan({
        silent: true,
        outputPath: scanResultsPath
      });
    }

    scanStats = {
      companies: scanRes.totalCompanies || 65,
      eligible_jobs: scanRes.total || (scanRes.jobs || []).length
    };

    // Reconcile job lifecycle state against latest scan results
    try {
      reconcileJobLifecycle(scanRes.jobs);
    } catch {}

    updateStatus({
      phase: "selecting",
      scan: scanStats
    });

    if (!silent) {
      console.log(`  ✓ Scan complete: ${scanStats.companies} tracked companies | ${scanStats.eligible_jobs} eligible postings`);
    }

    // ── STEP 2: SELECT & EVALUATE OFFICIAL ATS CANDIDATES ────────────────────
    updateStatus({ phase: "evaluating_official" });
    if (!silent) console.log(`\n▶ Step 2/4: Selecting & evaluating top official ATS candidates (up to ${employerAtsLimit})...`);

    let officialBatchResult = { evaluated: [], total: 0, succeeded: 0, failed: 0, cached: 0 };
    try {
      officialBatchResult = await evaluateBatch({
        limit: employerAtsLimit,
        source: "employer_ats",
        concurrency,
        force,
        dryRun,
        provider: options.provider,
        json: silent,
        scanResultsPath,
        cachePath
      });
    } catch (err) {
      errors.push(`Official ATS evaluation warning: ${err.message}`);
      if (!silent) console.warn(`  ⚠️ Official evaluation error: ${err.message}`);
    }

    evalStats.official_selected = officialBatchResult.total || 0;
    evalStats.official_evaluated = officialBatchResult.succeeded || 0;
    evalStats.official_cached = officialBatchResult.cached || 0;

    if (!silent) {
      console.log(`  ✓ Official ATS evaluated: ${evalStats.official_evaluated}/${evalStats.official_selected} (${evalStats.official_cached} cached)`);
    }

    // ── STEP 3: SELECT & EVALUATE AGGREGATOR / DISCOVERY CANDIDATES ──────────
    updateStatus({ phase: "evaluating_discovery" });
    if (!silent) console.log(`\n▶ Step 3/4: Selecting & evaluating discovery/aggregator candidates (up to ${aggregatorLimit})...`);

    let aggBatchResult = { evaluated: [], total: 0, succeeded: 0, failed: 0, cached: 0 };
    try {
      aggBatchResult = await evaluateBatch({
        limit: aggregatorLimit,
        source: "aggregator",
        concurrency,
        force,
        dryRun,
        provider: options.provider,
        json: silent,
        scanResultsPath,
        cachePath
      });
    } catch (err) {
      errors.push(`Aggregator evaluation warning: ${err.message}`);
      if (!silent) console.warn(`  ⚠️ Aggregator evaluation error: ${err.message}`);
    }

    evalStats.aggregator_selected = aggBatchResult.total || 0;
    evalStats.aggregator_evaluated = aggBatchResult.succeeded || 0;
    evalStats.aggregator_cached = aggBatchResult.cached || 0;

    evalStats.cached_reused = evalStats.official_cached + evalStats.aggregator_cached;
    evalStats.ai_calls_made = (evalStats.official_evaluated - evalStats.official_cached) +
                              (evalStats.aggregator_evaluated - evalStats.aggregator_cached);

    if (!silent) {
      console.log(`  ✓ Aggregator evaluated: ${evalStats.aggregator_evaluated}/${evalStats.aggregator_selected} (${evalStats.aggregator_cached} cached)`);
    }

    // ── STEP 4: REBUILD QUEUE ────────────────────────────────────────────────
    updateStatus({ phase: "rebuilding_queue", evaluation: evalStats });
    if (!silent) console.log(`\n▶ Step 4/4: Rebuilding curated daily application queue...`);

    const refreshedScanData = JSON.parse(fs.readFileSync(scanResultsPath, "utf8"));
    const allJobs = refreshedScanData.jobs || [];
    const appState = loadApplicationState();
    const lifecycleState = loadJobLifecycleState();

    const { active: unActioned, saved, applied, notInterested } = filterJobsByState(allJobs, appState);
    const { active: activeEligible, stale, expired } = filterJobsByLifecycle(unActioned, lifecycleState);
    const activeQueue = partitionQueue(activeEligible, 5);

    const queueStats = {
      apply: activeQueue.apply.length,
      consider: activeQueue.consider.length,
      new: (activeQueue.unevaluated || []).length
    };

    const completedAt = new Date().toISOString();
    const durationSec = ((Date.parse(completedAt) - Date.parse(startedAt)) / 1000).toFixed(1);

    const finalStatus = updateStatus({
      status: errors.length > 0 ? "completed_with_warnings" : "complete",
      phase: "complete",
      completed_at: completedAt,
      duration_sec: Number(durationSec),
      scan: scanStats,
      evaluation: evalStats,
      queue: queueStats,
      errors
    });

    if (!silent) {
      console.log(`\n${"═".repeat(72)}`);
      console.log(`✅ DAILY PIPELINE COMPLETE (${durationSec}s)`);
      console.log(`${"═".repeat(72)}`);
      console.log(`🔥 1. APPLY NOW:    ${queueStats.apply} recommendations (max 5/company)`);
      console.log(`🟡 2. CONSIDER:     ${queueStats.consider} backup opportunities`);
      console.log(`📋 3. NEW / UNEVAL: ${queueStats.new} top deterministic matches`);
      console.log(`\n📊 AI Metrics:`);
      console.log(`  • AI calls made:           ${evalStats.ai_calls_made}`);
      console.log(`  • Cached evaluations used: ${evalStats.cached_reused}`);
      console.log(`  • Total evaluations:       ${evalStats.official_evaluated + evalStats.aggregator_evaluated}`);
      console.log(`  • Pipeline Errors:         ${errors.length}`);
      console.log(`${"═".repeat(72)}\n`);
    }

    return finalStatus;
  } catch (err) {
    const failedStatus = updateStatus({
      status: "failed",
      phase: "failed",
      completed_at: new Date().toISOString(),
      errors: [...errors, err.message]
    });
    if (!silent) {
      console.error(`\n❌ Daily pipeline failed: ${err.message}`);
    }
    throw err;
  } finally {
    releaseLock();
  }
}

// ── CLI Runner ───────────────────────────────────────────────────────────────
const isDirectCli = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
  process.argv[1].endsWith("/daily-pipeline.mjs") ||
  process.argv[1].endsWith("\\daily-pipeline.mjs")
);

if (isDirectCli) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("--dryRun");
  const force = args.includes("--force");
  const limitArg = args.find(a => a.startsWith("--limit="))?.split("=")[1];
  const atsLimitArg = args.find(a => a.startsWith("--employerAtsLimit="))?.split("=")[1] || limitArg;
  const aggLimitArg = args.find(a => a.startsWith("--aggregatorLimit="))?.split("=")[1];
  const concurrencyArg = args.find(a => a.startsWith("--concurrency="))?.split("=")[1];

  const skipScan = args.includes("--skip-scan") || args.includes("--skipScan");
  const options = { dryRun, force, skipScan, silent: false };
  if (atsLimitArg && !isNaN(Number(atsLimitArg))) options.employerAtsLimit = Number(atsLimitArg);
  if (aggLimitArg && !isNaN(Number(aggLimitArg))) options.aggregatorLimit = Number(aggLimitArg);
  if (concurrencyArg && !isNaN(Number(concurrencyArg))) options.concurrency = Number(concurrencyArg);

  runDailyPipeline(options).catch(err => {
    process.exit(1);
  });
}


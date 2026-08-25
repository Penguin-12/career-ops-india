#!/usr/bin/env node
/**
 * scripts/dashboard-server.mjs — Local HTTP Server & API for Career-Ops Dashboard
 * 
 * Built with Node.js native HTTP module. Zero external framework dependencies.
 * Provides REST endpoints for job inspection, application state persistence,
 * and serves the reactive dashboard web interface.
 * 
 * Run:  node scripts/dashboard-server.mjs
 * Run:  npm run dashboard
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import {
  loadApplicationState,
  saveApplicationState,
  getJobStatus,
  setJobStatus,
  clearJobStatus,
  enrichJobsWithState,
  filterJobsByState,
  getJobId,
  VALID_STATUSES
} from "./state-service.mjs";
import {
  loadJobLifecycleState,
  saveJobLifecycleState,
  getJobLifecycleStatus,
  setJobLifecycleStatus,
  enrichJobsWithLifecycle,
  filterJobsByLifecycle,
  VALID_LIFECYCLE_STATUSES
} from "./job-lifecycle-service.mjs";
import { partitionQueue, diversifyJobs } from "./queue-core.mjs";
import { runDailyPipeline, getPipelineStatus, isPipelineRunning } from "./daily-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCAN_RESULTS_PATH = path.join(ROOT, "data/scan_results.json");
const TEMPLATE_PATH = path.join(ROOT, "templates/dashboard.html");
const DEFAULT_PORT = parseInt(process.env.PORT || "3000", 10);

/**
 * Loads canonical scan results from disk safely.
 */
function loadScanResults() {
  if (!fs.existsSync(SCAN_RESULTS_PATH)) {
    return { scanned_at: null, total: 0, jobs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(SCAN_RESULTS_PATH, "utf8"));
  } catch (err) {
    console.error(`⚠️ Failed to parse scan_results.json: ${err.message}`);
    return { scanned_at: null, total: 0, jobs: [] };
  }
}

/**
 * Parses a job ID of the form "{source}:{url}" into its components.
 * Keys in application_state.json and job_lifecycle_state.json all use this format.
 */
function parseJobId(jobId) {
  const colonIdx = jobId.indexOf(":");
  if (colonIdx === -1) return { source: "unknown", url: null };
  return {
    source: jobId.substring(0, colonIdx),
    url: jobId.substring(colonIdx + 1)
  };
}

/**
 * Extracts a human-readable company hint from a job URL and source name.
 * Used only for orphan stubs where the canonical scan record is no longer present.
 */
function extractCompanyHint(url, source) {
  if (!url) return source || "Unknown";
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    // Workday: {company}.wd{n}.myworkdayjobs.com
    const workdayMatch = hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
    if (workdayMatch) {
      const name = workdayMatch[1];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }

    // OracleCloud: {company}.fa.oraclecloud.com
    const oracleMatch = hostname.match(/^([a-z0-9-]+)\.fa\.oraclecloud\.com$/);
    if (oracleMatch) {
      return oracleMatch[1].toUpperCase();
    }

    // SmartRecruiters: jobs.smartrecruiters.com/{Company}/...
    if (hostname.includes("smartrecruiters.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        // CamelCase company slug → words
        return parts[0].replace(/([A-Z])/g, " $1").trim();
      }
    }

    // Greenhouse: boards.greenhouse.io/{company}/jobs/{id}
    if (hostname.includes("greenhouse.io")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        const name = parts[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
    }

    // Direct company domain: okta.com → "Okta"
    const domainParts = hostname.split(".");
    if (domainParts.length >= 2) {
      const name = domainParts[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }

    return hostname;
  } catch {
    return source || "Unknown";
  }
}

/**
 * Builds lightweight "orphan" job stubs for state/lifecycle records that have no
 * corresponding job in the current scan_results.json.
 *
 * Mode "applied": iterates appState, builds stubs for applied/oa/interview/rejected/withdrawn.
 * Mode "expired": iterates lifecycleState, builds stubs for expired records.
 *
 * Each stub is independently enriched from both state files so that a job that is
 * simultaneously applied AND expired (in different files) appears correctly in both
 * the Applied and Expired views — preserving state/lifecycle independence.
 *
 * @param {"applied"|"expired"} mode
 * @param {object} appState        - full application_state.json object
 * @param {object} lifecycleState  - full job_lifecycle_state.json object
 * @param {Set<string>} scanJobIds - set of job_id values present in current scan
 * @returns {Array} orphan job stubs
 */
function buildOrphanJobs(mode, appState, lifecycleState, scanJobIds) {
  const APPLIED_STATUSES = new Set(["applied", "oa", "interview", "rejected", "withdrawn"]);
  const orphans = [];

  if (mode === "applied") {
    for (const [id, entry] of Object.entries(appState)) {
      if (scanJobIds.has(id)) continue; // in scan → handled by normal join path
      if (!APPLIED_STATUSES.has(entry.status)) continue;

      const { source, url } = parseJobId(id);
      const lifecycleEntry = lifecycleState[id];
      const snap = entry.job || entry.snapshot || null;

      orphans.push({
        job_id: id,
        source,
        url: snap?.url || entry.url || url,
        company: snap?.company || entry.company || extractCompanyHint(url, source),
        title: snap?.title || entry.title || "(Position no longer listed)",
        location: snap?.location || entry.location || "—",
        department: "",
        is_orphan: true,
        tier: "2",
        priority: "GOOD",
        is_stretch: false,
        freshness_tier: "active",
        age_days: null,
        application_state: {
          status: entry.status,
          updated_at: entry.updated_at || null,
          notes: entry.notes || ""
        },
        lifecycle: lifecycleEntry
          ? {
              status: lifecycleEntry.status,
              updated_at: lifecycleEntry.updated_at || null,
              source: lifecycleEntry.source || "manual"
            }
          : { status: "active", updated_at: null, source: "system" }
      });
    }
  } else if (mode === "expired") {
    for (const [id, entry] of Object.entries(lifecycleState)) {
      if (scanJobIds.has(id)) continue; // in scan → handled by allEnriched filter
      if (entry.status !== "expired") continue;

      const { source, url } = parseJobId(id);
      const appEntry = appState[id];
      const snap = appEntry?.job || appEntry?.snapshot || entry.job || entry.snapshot || null;

      orphans.push({
        job_id: id,
        source,
        url: snap?.url || appEntry?.url || entry.url || url,
        company: snap?.company || appEntry?.company || entry.company || extractCompanyHint(url, source),
        title: snap?.title || appEntry?.title || entry.title || "(Position no longer listed)",
        location: snap?.location || appEntry?.location || entry.location || "—",
        department: "",
        is_orphan: true,
        tier: "2",
        priority: "GOOD",
        is_stretch: false,
        freshness_tier: "active",
        age_days: null,
        application_state: appEntry
          ? {
              status: appEntry.status,
              updated_at: appEntry.updated_at || null,
              notes: appEntry.notes || ""
            }
          : { status: "new", updated_at: null, notes: "" },
        lifecycle: {
          status: entry.status,
          updated_at: entry.updated_at || null,
          source: entry.source || "manual"
        }
      });
    }
  }

  return orphans;
}

/**
 * Builds the aggregated payload combining canonical jobs, state, lifecycle, and partitioned queues.
 *
 * Applied and Expired counts are authoritative: they include both scan-matched jobs and orphan
 * records (jobs whose state/lifecycle is persisted but whose scan listing has since been removed).
 * State and lifecycle remain fully independent — a job can appear in both Applied and Expired.
 */
export function buildDashboardData(options = {}) {
  const scanData = options.scanData || loadScanResults(options.scanResultsFile);
  const rawJobs = options.jobs || scanData.jobs || [];
  const appState = options.appState || loadApplicationState(options.appStateFile);
  const lifecycleState = options.lifecycleState || loadJobLifecycleState(options.lifecycleFile);

  // Enrich all scan jobs with both application state and lifecycle status
  const enrichedWithState = enrichJobsWithState(rawJobs, appState);
  const allEnriched = enrichJobsWithLifecycle(enrichedWithState, lifecycleState);

  // Build the set of job IDs that are present in the current scan
  const scanJobIds = new Set(allEnriched.map(j => j.job_id));

  // Partition scan jobs by user application state
  const { active: unActioned, saved, applied: appliedFromScan, notInterested } = filterJobsByState(allEnriched, appState);

  // Partition un-actioned scan jobs by lifecycle state
  const { active: activeEligible } = filterJobsByLifecycle(unActioned, lifecycleState);

  // Partition active (new/un-actioned + active-lifecycle) jobs through canonical queue ranking & diversification
  const activeQueue = partitionQueue(activeEligible, 5);

  // Collect expired/stale jobs from scan (jobs in scan_results with lifecycle = expired/stale)
  const expiredFromScan = allEnriched.filter(j => j.lifecycle?.status === "expired");
  const allStale = allEnriched.filter(j => j.lifecycle?.status === "stale");

  // Build orphan records for jobs with persisted state but absent from current scan.
  // An applied+expired job produces stubs in BOTH lists — state/lifecycle independence preserved.
  const orphanApplied = buildOrphanJobs("applied", appState, lifecycleState, scanJobIds);
  const orphanExpired = buildOrphanJobs("expired", appState, lifecycleState, scanJobIds);

  // Merge: scan-matched + orphans (no overlap possible — orphans are by definition absent from scan)
  const applied = [...appliedFromScan, ...orphanApplied];
  const allExpired = [...expiredFromScan, ...orphanExpired];

  return {
    scanned_at: scanData.scanned_at,
    total_scanned: rawJobs.length,
    counts: {
      total: rawJobs.length,
      active: activeEligible.length,
      saved: saved.length,
      applied: applied.length,
      not_interested: notInterested.length,
      expired: allExpired.length,
      stale: allStale.length,
      apply_now: activeQueue.apply.length,
      consider: activeQueue.consider.length,
      unevaluated: (activeQueue.unevaluated || []).length
    },
    queue: activeQueue,
    saved,
    applied,
    not_interested: notInterested,
    expired: allExpired,
    stale: allStale,
    all: allEnriched
  };
}

/**
 * Parses JSON request body.
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error(`Malformed JSON payload: ${e.message}`));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Creates the HTTP Request Handler.
 */
export function createRequestHandler() {
  return async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // CORS & Content-Type helpers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 1. GET /api/jobs
      if (pathname === "/api/jobs" && method === "GET") {
        const data = buildDashboardData();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
        return;
      }

      // 2. GET /api/state
      if (pathname === "/api/state" && method === "GET") {
        const state = loadApplicationState();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(state));
        return;
      }

      // 3. POST /api/state
      if (pathname === "/api/state" && method === "POST") {
        const payload = await parseRequestBody(req);
        const { jobId, status, notes, job, snapshot } = payload;

        if (!jobId || typeof jobId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required string 'jobId'" }));
          return;
        }

        const normStatus = String(status || "").toLowerCase().trim();
        if (!VALID_STATUSES.has(normStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid status '${status}'. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}` }));
          return;
        }

        let jobRecord = job || snapshot || null;
        if (!jobRecord) {
          const scanData = loadScanResults();
          jobRecord = (scanData.jobs || []).find(j => (j.job_id === jobId || getJobId(j) === jobId)) || null;
        }

        const result = setJobStatus(jobId, normStatus, { notes, job: jobRecord });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, result }));
        return;
      }

      // 4. GET /api/lifecycle
      if (pathname === "/api/lifecycle" && method === "GET") {
        const lifecycleState = loadJobLifecycleState();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(lifecycleState));
        return;
      }

      // 5. POST /api/lifecycle
      if (pathname === "/api/lifecycle" && method === "POST") {
        const payload = await parseRequestBody(req);
        const { jobId, status, notes } = payload;

        if (!jobId || typeof jobId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required string 'jobId'" }));
          return;
        }

        const normStatus = String(status || "").toLowerCase().trim();
        if (!VALID_LIFECYCLE_STATUSES.has(normStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid lifecycle status '${status}'. Must be one of: ${Array.from(VALID_LIFECYCLE_STATUSES).join(", ")}` }));
          return;
        }

        const result = setJobLifecycleStatus(jobId, normStatus, { source: "manual", notes });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, result }));
        return;
      }

      // 6. POST /api/pipeline/run
      if (pathname === "/api/pipeline/run" && method === "POST") {
        if (isPipelineRunning()) {
          res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Pipeline already running", status: getPipelineStatus() }));
          return;
        }
        const payload = await parseRequestBody(req).catch(() => ({}));
        // Trigger pipeline execution asynchronously
        runDailyPipeline({ ...payload, silent: true }).catch(err => {
          console.error(`Background daily pipeline error: ${err.message}`);
        });
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ message: "Daily pipeline started", status: getPipelineStatus() }));
        return;
      }

      // 5. GET /api/pipeline/status
      if (pathname === "/api/pipeline/status" && method === "GET") {
        const status = getPipelineStatus();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(status));
        return;
      }

      // 6. Static UI (GET / or /index.html)
      if (pathname === "/" || pathname === "/index.html" || pathname === "/dashboard") {
        if (!fs.existsSync(TEMPLATE_PATH)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Template dashboard.html not found.");
          return;
        }
        const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(template);
        return;
      }

      // 404 for other paths
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      console.error(`❌ HTTP Request Error: ${err.message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  };
}

/**
 * Starts the Dashboard server on an available port.
 */
export function startServer(port = DEFAULT_PORT, autoOpen = false) {
  return new Promise((resolve, reject) => {
    const handler = createRequestHandler();
    const server = http.createServer(handler);

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} is occupied, trying port ${port + 1}...`);
        startServer(port + 1, autoOpen).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`\n🚀 Career-Ops Dashboard running at: ${url}`);
      console.log(`   Press Ctrl+C to stop the dashboard server.\n`);

      if (autoOpen) {
        const openCmd = process.platform === "darwin" ? "open" :
                        process.platform === "win32" ? "start" : "xdg-open";
        exec(`${openCmd} "${url}"`, (err) => {
          if (err) {
            console.log(`Open ${url} in your browser.`);
          }
        });
      }

      resolve({ server, port, url });
    });
  });
}

// Auto-run if executed directly
if (process.argv[1] && (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) || process.argv[1].endsWith("dashboard-server.mjs"))) {
  const autoOpen = !process.argv.includes("--no-open");
  startServer(DEFAULT_PORT, autoOpen).catch(err => {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
}


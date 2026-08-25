/**
 * scripts/ai/evaluator.mjs — AI Job Evaluator Engine, Cache Manager & Quality Validator
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import yaml from "js-yaml";
import { buildEvaluationPrompt } from "./prompt.mjs";
import { getAIProvider, MockProvider } from "./provider.mjs";

const CACHE_FILE = "data/.ai_cache.json";
const SCAN_RESULTS_FILE = "data/scan_results.json";

/**
 * Computes a deterministic SHA-256 hash key for caching evaluation results
 */
export function computeCacheKey(job, profileText, cvText) {
  const hash = crypto.createHash("sha256");
  hash.update(String(job.url || ""));
  hash.update(String(job.title || ""));
  hash.update(String(job.company || ""));
  hash.update(String(job.description || job.snippet || ""));
  hash.update(String(profileText || ""));
  hash.update(String(cvText || ""));
  return hash.digest("hex");
}

export function loadCache(cachePath = CACHE_FILE) {
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

export function saveCache(cache, cachePath = CACHE_FILE) {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

/**
 * Validates model evaluation output for suspicious edge cases and flags them
 */
export function validateEvaluation(evaluation, job, profile, cvText) {
  const flags = [];
  const rec = evaluation.recommendation;
  const techFit = evaluation.technical_fit || 0;
  const appProb = evaluation.application_probability || 0;
  const expFit = evaluation.experience_fit || 0;

  // 1. High recommendation with low technical fit
  if (rec === "APPLY" && techFit < 15) {
    flags.push("low_technical_fit_for_apply");
  }

  // 2. High recommendation with low application probability
  if (rec === "APPLY" && appProb < 7) {
    flags.push("low_application_probability_for_apply");
  }

  // 3. Non-engineering / support role recommended for APPLY
  if (["application_support", "consulting_solutions", "non_technical"].includes(job.role_family) && rec === "APPLY") {
    flags.push(`non_engineering_role_family_apply (${job.role_family})`);
  }

  // 4. Job is senior/lead/staff/principal but given maximum experience fit
  const titleLower = String(job.title || "").toLowerCase();
  if (["staff", "principal", "lead", "sde_3"].includes(job.job_seniority) || /\b(7\+|8\+|10\+|principal|staff|director)\b/i.test(titleLower)) {
    if (expFit >= 18) {
      flags.push("suspicious_high_experience_fit_for_senior_role");
    }
  }

  // 5. Hallucination check in alignment: claims skills completely missing from candidate context
  const cvLower = (cvText || "").toLowerCase();
  const profileSkills = ((profile?.candidate?.skills) || []).map(s => s.toLowerCase());
  const combinedContext = `${cvLower} ${profileSkills.join(" ")}`;

  (evaluation.resume_alignment || []).forEach(claim => {
    const unverifiedTechs = ["ruby on rails", "rust", "scala", "golang", "php", "swift", "kotlin", "cobol", "mainframe"];
    for (const tech of unverifiedTechs) {
      if (claim.toLowerCase().includes(tech) && !combinedContext.includes(tech)) {
        flags.push(`potential_hallucination_in_alignment (${tech})`);
      }
    }
  });

  return flags;
}

/**
 * Evaluates a single job posting
 */
export async function evaluateJob(job, options = {}) {
  const profile = options.profile;
  const profileText = options.profileText || (profile ? JSON.stringify(profile) : "");
  const cvText = options.cvText || "";
  const provider = options.provider || getAIProvider(options);
  const cache = options.cache || loadCache(options.cachePath);
  const force = !!options.force;

  if (!cvText) {
    throw new Error("Missing candidate CV text (cv.md)");
  }

  const cacheKey = computeCacheKey(job, profileText, cvText);
  if (!force && cache[cacheKey]) {
    const cachedEval = cache[cacheKey];
    const flags = validateEvaluation(cachedEval, job, profile, cvText);
    return {
      ...job,
      ai_evaluation: {
        ...cachedEval,
        validation_flags: flags,
        cached: true
      }
    };
  }

  const prompt = buildEvaluationPrompt(job, profile, cvText);
  const rawEvaluation = await provider.generate(prompt);
  const validation_flags = validateEvaluation(rawEvaluation, job, profile, cvText);

  const enrichedEvaluation = {
    ...rawEvaluation,
    validation_flags,
    evaluated_at: new Date().toISOString(),
    provider: provider.name,
    model: provider.model,
    cached: false
  };

  // Immediate cache persistence
  cache[cacheKey] = enrichedEvaluation;
  if (!options.skipCacheSave) {
    saveCache(cache, options.cachePath);
  }

  return {
    ...job,
    ai_evaluation: enrichedEvaluation
  };
}

/**
 * Selects and prioritizes candidate jobs for AI evaluation
 */
export function selectJobsForEvaluation(jobList, options = {}) {
  const limit = typeof options.limit === "number" ? options.limit : 30;
  const force = !!options.force;
  const filterUrl = options.url;
  const filterCompany = options.company ? String(options.company).toLowerCase().trim() : null;
  const filterSource = options.source ? String(options.source).toLowerCase().trim() : null;

  let candidates = [...jobList];

  if (filterUrl) {
    return candidates.filter(j => j.url === filterUrl);
  }

  if (filterCompany) {
    candidates = candidates.filter(j => String(j.company || "").toLowerCase().includes(filterCompany));
  }

  if (filterSource) {
    if (filterSource === "aggregator") {
      candidates = candidates.filter(j => j.source_type === "aggregator" || j.source === "naukri" || j.source === "smart_scraper");
    } else if (filterSource === "employer_ats" || filterSource === "official") {
      candidates = candidates.filter(j => j.source_type === "employer_ats" || j.source_type === "employer_careers" || (!j.source_type && j.source !== "naukri"));
    }
  }

  if (!force) {
    candidates = candidates.filter(j => !j.ai_evaluation);
  }

  candidates.sort((a, b) => {
    // 1. Source type priority: employer ATS outranks aggregator
    const aIsAggregator = a.source_type === "aggregator" || a.source === "naukri" ? 1 : 0;
    const bIsAggregator = b.source_type === "aggregator" || b.source === "naukri" ? 1 : 0;
    if (aIsAggregator !== bIsAggregator) return aIsAggregator - bIsAggregator;

    // 2. For aggregators: normal risk outranks staffing agency risk
    const aStaffing = a.discovery_risk === "staffing_agency_risk" ? 1 : 0;
    const bStaffing = b.discovery_risk === "staffing_agency_risk" ? 1 : 0;
    if (aStaffing !== bStaffing) return aStaffing - bStaffing;

    // 3. Freshness confidence: high outranks unknown
    const aConf = a.freshness_confidence === "high" ? 0 : 1;
    const bConf = b.freshness_confidence === "high" ? 0 : 1;
    if (aConf !== bConf) return aConf - bConf;

    // 4. Deterministic score descending
    const aScore = a.score ?? 50;
    const bScore = b.score ?? 50;
    if (aScore !== bScore) return bScore - aScore;

    // 5. Age ascending
    return (a.age_days || 0) - (b.age_days || 0);
  });

  return candidates.slice(0, limit);
}

/**
 * Evaluates a batch of jobs with controlled concurrency, per-job timeout, immediate incremental persistence, and real-time progress logging
 */
export async function evaluateBatch(options = {}) {
  const startTime = Date.now();
  const limit = typeof options.limit === "number" ? options.limit : 30;
  const concurrency = Math.max(1, Math.min(10, typeof options.concurrency === "number" ? options.concurrency : 3));
  const jobTimeoutMs = (typeof options.timeout === "number" ? options.timeout : 60) * 1000;
  const force = !!options.force;
  const dryRun = !!options.dryRun || !!options["dry-run"];
  const jsonMode = !!options.json;
  const scanResultsPath = options.scanResultsPath || SCAN_RESULTS_FILE;

  if (!fs.existsSync(scanResultsPath)) {
    throw new Error(`Scan results file not found at ${scanResultsPath}. Run 'npm run scan' first.`);
  }

  const scanData = JSON.parse(fs.readFileSync(scanResultsPath, "utf8"));
  const allJobs = scanData.jobs || [];

  if (allJobs.length === 0) {
    if (!jsonMode) console.log("⚠️ No matching jobs found in scan results to evaluate.");
    return { evaluated: [], total: 0, succeeded: 0, failed: 0, cached: 0, durationSec: 0 };
  }

  // Load candidate profile and CV
  const profilePath = options.profilePath || (fs.existsSync("config/profile.yml") ? "config/profile.yml" : "config/profile.example.yml");
  const cvPath = options.cvPath || (fs.existsSync("cv.md") ? "cv.md" : "templates/cv-template.md");

  if (!fs.existsSync(cvPath)) {
    throw new Error(`CV file not found at ${cvPath}`);
  }
  const cvText = fs.readFileSync(cvPath, "utf8");

  let profile = {};
  let profileText = "";
  if (fs.existsSync(profilePath)) {
    profileText = fs.readFileSync(profilePath, "utf8");
    profile = yaml.load(profileText) || {};
  }

  // If dry-run, use a deterministic mock synthesizer
  let provider;
  if (dryRun) {
    provider = new MockProvider((prompt) => {
      return {
        ai_score: 90,
        recommendation: "APPLY",
        confidence: "HIGH",
        technical_fit: 23,
        experience_fit: 18,
        stack_fit: 18,
        career_trajectory: 18,
        application_probability: 13,
        strengths: ["Dry-run simulated evaluation match"],
        gaps: ["Dry-run simulated gap check"],
        why_apply: "Dry-run simulation: strong engineering alignment.",
        why_not: "Dry-run simulation: verify specific team requirements.",
        resume_alignment: ["Wells Fargo: Kubernetes & microservices"],
        missing_requirements: []
      };
    });
    provider.name = "dry_run_mock";
    provider.model = "dry-run-v1";
  } else {
    provider = options.provider || getAIProvider(options);
  }

  const cache = loadCache(options.cachePath);

  // Select candidate jobs using source-aware ranking and cost controls
  const targetJobs = selectJobsForEvaluation(allJobs, {
    limit,
    force,
    url: options.url,
    company: options.company,
    source: options.source
  });
  const total = targetJobs.length;

  const persistJobResult = (jobWithAi) => {
    try {
      const idx = scanData.jobs.findIndex(
        j => j.title?.trim() === jobWithAi.title?.trim() && j.company?.trim() === jobWithAi.company?.trim()
      );
      if (idx !== -1) {
        scanData.jobs[idx] = {
          ...scanData.jobs[idx],
          ai_evaluation: jobWithAi.ai_evaluation,
          ai_evaluation_error: jobWithAi.ai_evaluation_error
        };
        scanData.ai_evaluated_at = new Date().toISOString();
        if (!options.skipFileSave) {
          fs.writeFileSync(scanResultsPath, JSON.stringify(scanData, null, 2), "utf8");
        }
      }
    } catch {
      // ignore
    }
  };

  let completedCount = 0;
  let cacheHits = 0;
  let succeededCount = 0;
  let failedCount = 0;
  const results = new Array(total);

  let nextIndex = 0;

  async function worker() {
    while (nextIndex < total) {
      const currentIndex = nextIndex++;
      const job = targetJobs[currentIndex];
      const jobNum = currentIndex + 1;
      const jobStart = Date.now();

      if (!jsonMode) {
        console.log(`  [${jobNum}/${total}] Evaluating ${job.company} — "${job.title.slice(0, 45)}"...`);
      }

      let timer;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out after ${jobTimeoutMs / 1000}s`)), jobTimeoutMs);
        });

        const evalPromise = evaluateJob(job, {
          provider,
          profile,
          profileText,
          cvText,
          cache,
          force,
          cachePath: options.cachePath,
          skipCacheSave: dryRun // don't cache dry-run results
        });

        const enrichedJob = await Promise.race([evalPromise, timeoutPromise]);
        clearTimeout(timer);
        const ai = enrichedJob.ai_evaluation;
        const duration = ((Date.now() - jobStart) / 1000).toFixed(1);

        if (ai.cached) cacheHits++;
        succeededCount++;
        completedCount++;

        if (!dryRun) {
          persistJobResult(enrichedJob);
        }

        if (!jsonMode) {
          const badge = ai.recommendation === "APPLY" ? "🟢 APPLY" : (ai.recommendation === "CONSIDER" ? "🟡 CONSIDER" : "⚪ SKIP");
          const cacheTag = ai.cached ? "cached" : `${duration}s`;
          const flagNotice = ai.validation_flags && ai.validation_flags.length ? ` 🚩 [${ai.validation_flags.join(", ")}]` : "";
          console.log(`  [${jobNum}/${total}] ✅ ${job.company} -> ${badge} [${ai.ai_score}/100 AI] (${cacheTag})${flagNotice}`);
        }

        results[currentIndex] = enrichedJob;
      } catch (err) {
        clearTimeout(timer);
        failedCount++;
        completedCount++;
        const duration = ((Date.now() - jobStart) / 1000).toFixed(1);
        const failedJob = {
          ...job,
          ai_evaluation_error: err.message
        };
        if (!dryRun) {
          persistJobResult(failedJob);
        }

        if (!jsonMode) {
          console.log(`  [${jobNum}/${total}] ❌ ${job.company} — "${job.title.slice(0, 35)}" FAILED (${duration}s): ${err.message}`);
        }

        results[currentIndex] = failedJob;
      }
    }
  }

  const workerCount = Math.min(concurrency, total);
  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!jsonMode) {
    console.log(`\n${"═".repeat(72)}`);
    console.log(`🏁 AI Evaluation Complete`);
    console.log(`   Evaluated: ${total}`);
    console.log(`   Succeeded: ${succeededCount}`);
    console.log(`   Failed:    ${failedCount}`);
    console.log(`   Cached:    ${cacheHits}`);
    console.log(`   Duration:  ${durationSec}s`);
    console.log(`💾 Results saved to ${scanResultsPath} and cached in ${CACHE_FILE}`);
    console.log(`${"═".repeat(72)}\n`);
  }

  return {
    evaluated: results,
    total,
    succeeded: succeededCount,
    failed: failedCount,
    cached: cacheHits,
    durationSec: Number(durationSec)
  };
}

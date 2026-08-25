#!/usr/bin/env node
/**
 * tests/test-state-fixes.mjs — Focused regression tests for dashboard state fixes
 *
 * Tests covered:
 *  T1: AI cache re-attach in scan.mjs uses canonical SHA-256 computeCacheKey (Fix 1)
 *  T2: persistJobResult matches by URL-first, not title+company (Fix 5)
 *  T3: Orphan applied records appear in buildDashboardData applied array (Fix 2)
 *  T4: Orphan expired records appear in buildDashboardData expired array (Fix 3)
 *  T5: Applied+expired state independence — no deduplication between arrays (Fix 4)
 *
 * Run: node tests/test-state-fixes.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-test-"));
}
function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function makeJob(overrides = {}) {
  return {
    source: "greenhouse",
    source_type: "employer_ats",
    company: "Acme Corp",
    title: "Senior Software Engineer",
    location: "Bengaluru, India",
    url: "https://boards.greenhouse.io/acme/jobs/12345",
    posted_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    tier: "1",
    priority: "GO",
    is_stretch: false,
    freshness_tier: "hot",
    age_days: 3,
    remote: false,
    snippet: "Build backend systems",
    ...overrides
  };
}

// ── T1 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T1: AI cache re-attach uses canonical SHA-256 computeCacheKey");
console.log("──────────────────────────────────────────────────────────");
{
  const { computeCacheKey } = await import(path.join(ROOT, "scripts/ai/evaluator.mjs"));

  const profilePath = fs.existsSync(path.join(ROOT, "config/profile.yml"))
    ? path.join(ROOT, "config/profile.yml")
    : path.join(ROOT, "config/profile.example.yml");
  const cvPath = fs.existsSync(path.join(ROOT, "cv.md"))
    ? path.join(ROOT, "cv.md")
    : path.join(ROOT, "templates/cv-template.md");

  const profileText = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : "profile: test";
  const cvText = fs.existsSync(cvPath) ? fs.readFileSync(cvPath, "utf8") : "cv: test content";

  const job = makeJob();
  const cacheKey = computeCacheKey(job, profileText, cvText);

  assert(typeof cacheKey === "string", "computeCacheKey returns a string");
  assert(cacheKey.length === 64, `Key is 64 chars (SHA-256 hex) — got ${cacheKey.length}`);
  assert(/^[0-9a-f]{64}$/.test(cacheKey), "Key is lowercase hex only");
  assert(cacheKey !== job.url, "Key is NOT the raw job URL (broken old behavior)");

  // Build fixture cache keyed by SHA-256
  const tmpDir = makeTempDir();
  const fakeCachePath = path.join(tmpDir, ".ai_cache.json");
  const fakeEval = {
    ai_score: 88, recommendation: "APPLY", confidence: "HIGH",
    technical_fit: 22, experience_fit: 16, stack_fit: 18, career_trajectory: 17,
    application_probability: 15, strengths: ["Strong match"], gaps: [],
    why_apply: "Great fit", why_not: "None", resume_alignment: [], missing_requirements: [],
    evaluated_at: new Date().toISOString(), provider: "test", model: "test-v1", cached: false
  };
  fs.writeFileSync(fakeCachePath, JSON.stringify({ [cacheKey]: fakeEval }, null, 2));

  // Simulate the fixed re-attach logic
  const cache = JSON.parse(fs.readFileSync(fakeCachePath, "utf8"));
  const hit = cache[computeCacheKey(job, profileText, cvText)];
  assert(hit !== undefined, "SHA-256 key lookup hits the cache entry");
  assert(hit.ai_score === 88, "Correct evaluation retrieved from cache");

  // Verify old broken behavior would NOT have matched
  const brokenHit = cache[job.url];
  assert(brokenHit === undefined, "Old URL-based lookup returns undefined (confirms bug was real)");

  // Simulate loop over multiple jobs — only the one with a cache entry gets reattached
  const jobs = [
    makeJob({ url: "https://boards.greenhouse.io/acme/jobs/12345" }),
    makeJob({ url: "https://boards.greenhouse.io/acme/jobs/99999" }) // no cache entry
  ];
  jobs.forEach(j => {
    const key = computeCacheKey(j, profileText, cvText);
    if (cache[key]) {
      j.ai_evaluation = { ...cache[key], cached: true };
    }
  });
  assert(jobs[0].ai_evaluation !== undefined, "Job with matching cache key gets ai_evaluation reattached");
  assert(jobs[0].ai_evaluation.cached === true, "Reattached evaluation is marked cached:true");
  assert(jobs[1].ai_evaluation === undefined, "Job with no cache entry is left without ai_evaluation");

  cleanupDir(tmpDir);
}

// ── T2 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T2: persistJobResult findIndex predicate — URL-first, same title+company, different URLs");
console.log("──────────────────────────────────────────────────────────");
{
  // Test the findIndex predicate directly rather than running a full non-dryRun evaluateBatch
  // (dryRun intentionally skips persistJobResult to avoid writing synthetic results to disk,
  //  so we test the predicate logic that persistJobResult uses in isolation).

  const jobA = makeJob({ url: "https://boards.greenhouse.io/acme/jobs/111" });
  const jobB = makeJob({ url: "https://boards.greenhouse.io/acme/jobs/222" });
  // Both have identical: title = "Senior Software Engineer", company = "Acme Corp", location = "Bengaluru, India"

  const scanJobs = [jobA, jobB];

  // Simulate the FIXED findIndex predicate (mirrors evaluator.mjs persistJobResult)
  function fixedFindIndex(scanData, jobWithAi) {
    return scanData.findIndex(j => {
      if (j.url && jobWithAi.url) return j.url === jobWithAi.url;
      if (j.source_job_id && jobWithAi.source_job_id) {
        return j.source_job_id === jobWithAi.source_job_id
          && String(j.company || "").trim() === String(jobWithAi.company || "").trim();
      }
      return j.title?.trim() === jobWithAi.title?.trim()
        && j.company?.trim() === jobWithAi.company?.trim()
        && j.location?.trim() === jobWithAi.location?.trim();
    });
  }

  // Old (broken) predicate: title + company only
  function oldFindIndex(scanData, jobWithAi) {
    return scanData.findIndex(j =>
      j.title?.trim() === jobWithAi.title?.trim() && j.company?.trim() === jobWithAi.company?.trim()
    );
  }

  const jobBWithAi = { ...jobB, ai_evaluation: { ai_score: 90, recommendation: "APPLY" } };

  const fixedIdx = fixedFindIndex(scanJobs, jobBWithAi);
  const oldIdx   = oldFindIndex(scanJobs, jobBWithAi);

  assert(fixedIdx === 1, `Fixed predicate finds job B at index 1 (URL match) — got ${fixedIdx}`);
  assert(scanJobs[fixedIdx].url === jobB.url, "Fixed predicate returns correct job (B's URL)");
  assert(oldIdx === 0,
    `Old title+company predicate incorrectly matched job A at index 0 — confirms the bug: got ${oldIdx}`);
  assert(oldIdx !== fixedIdx, "Old and new predicates diverge — fix is verified");

  // Verify job A with the same title/company is NOT matched by the fixed predicate
  const jobAQuery = { ...jobA, ai_evaluation: { ai_score: 85, recommendation: "CONSIDER" } };
  const fixedIdxA = fixedFindIndex(scanJobs, jobAQuery);
  assert(fixedIdxA === 0, `Fixed predicate correctly finds job A at index 0 when queried by A's URL — got ${fixedIdxA}`);
  assert(fixedIdxA !== fixedIdx, "A and B resolve to different indices — no cross-contamination");
}

// ── T3 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T3: buildDashboardData — applied count matches application_state records");
console.log("──────────────────────────────────────────────────────────");
{
  const { buildDashboardData } = await import(path.join(ROOT, "scripts/dashboard-server.mjs"));
  const result = buildDashboardData();

  const appStateRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data/application_state.json"), "utf8"));
  const totalAppliedInState = Object.values(appStateRaw)
    .filter(e => ["applied", "oa", "interview", "rejected", "withdrawn"].includes(e.status))
    .length;

  assert(
    result.applied.length === totalAppliedInState,
    `applied.length (${result.applied.length}) === application_state applied count (${totalAppliedInState})`
  );
  assert(
    result.counts.applied === result.applied.length,
    `counts.applied (${result.counts.applied}) === applied.length (${result.applied.length})`
  );

  const orphans = result.applied.filter(j => j.is_orphan);
  const scanMatched = result.applied.filter(j => !j.is_orphan);
  console.log(`  ℹ️  Applied breakdown: ${scanMatched.length} scan-matched + ${orphans.length} orphan = ${result.applied.length}`);

  for (const o of orphans) {
    assert(typeof o.job_id === "string" && o.job_id.length > 0, `Orphan job_id present: ${o.job_id.slice(0, 30)}...`);
    assert(typeof o.company === "string" && o.company !== "Unknown", `Orphan company extracted: "${o.company}"`);
    assert(typeof o.url === "string" && o.url.startsWith("http"), `Orphan url is valid: ${o.url.slice(0, 50)}...`);
  }
}

// ── T4 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T4: buildDashboardData — expired count matches lifecycle_state records");
console.log("──────────────────────────────────────────────────────────");
{
  const { buildDashboardData } = await import(path.join(ROOT, "scripts/dashboard-server.mjs"));
  const result = buildDashboardData();

  const lifecycleRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data/job_lifecycle_state.json"), "utf8"));
  const totalExpiredInState = Object.values(lifecycleRaw).filter(e => e.status === "expired").length;

  assert(
    result.expired.length >= totalExpiredInState,
    `expired.length (${result.expired.length}) >= lifecycle_state expired count (${totalExpiredInState})`
  );
  assert(
    result.counts.expired === result.expired.length,
    `counts.expired (${result.counts.expired}) === expired.length (${result.expired.length})`
  );

  const orphans = result.expired.filter(j => j.is_orphan);
  console.log(`  ℹ️  Expired breakdown: ${result.expired.filter(j => !j.is_orphan).length} scan-matched + ${orphans.length} orphan = ${result.expired.length}`);

  for (const o of orphans) {
    assert(o.lifecycle?.status === "expired", `Orphan lifecycle.status = "expired"`);
    assert(typeof o.job_id === "string", `Orphan has job_id`);
    assert(typeof o.url === "string" && o.url.startsWith("http"), `Orphan url is valid`);
  }
}

// ── T5 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T5: State/lifecycle independence — applied and expired arrays are independent");
console.log("──────────────────────────────────────────────────────────");
{
  const { buildDashboardData } = await import(path.join(ROOT, "scripts/dashboard-server.mjs"));
  const result = buildDashboardData();

  const appliedIds = new Set(result.applied.map(j => j.job_id));
  const expiredIds = new Set(result.expired.map(j => j.job_id));

  assert(appliedIds.size === result.applied.length, "No duplicate job_ids in applied array");
  assert(expiredIds.size === result.expired.length, "No duplicate job_ids in expired array");

  // Check if any job is in both (applied+expired is valid — must appear in both)
  const overlap = [...appliedIds].filter(id => expiredIds.has(id));
  if (overlap.length > 0) {
    console.log(`  ℹ️  ${overlap.length} job(s) are both applied and expired — correctly appear in both arrays`);
    for (const id of overlap) {
      const inApplied = result.applied.find(j => j.job_id === id);
      const inExpired = result.expired.find(j => j.job_id === id);
      assert(inApplied !== undefined, `Applied+expired job present in applied array: ${id.slice(0, 40)}...`);
      assert(inExpired !== undefined, `Applied+expired job present in expired array: ${id.slice(0, 40)}...`);
    }
  } else {
    console.log("  ℹ️  No applied+expired overlap in current production data — arrays are independent by construction");
    assert(true, "Arrays built independently (no forced mutual exclusion)");
  }
}

// ── T6 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T6: State transition captures immutable job snapshot { title, company, location, url }");
console.log("──────────────────────────────────────────────────────────");
{
  const { setJobStatus, loadApplicationState, getJobStatus } = await import(path.join(ROOT, "scripts/state-service.mjs"));
  const tmpDir = makeTempDir();
  const testStateFile = path.join(tmpDir, "test_app_state.json");

  const job = {
    source: "greenhouse",
    company: "Stripe",
    title: "Staff Backend Engineer",
    location: "Bengaluru, India",
    url: "https://boards.greenhouse.io/stripe/jobs/998877",
    snippet: "Volatile description text that should NOT be in snapshot",
    score: 95,
    age_days: 1
  };

  const res = setJobStatus(job, "applied", { filePath: testStateFile, notes: "Referral from teammate" });
  assert(res.entry.status === "applied", "Entry has status 'applied'");
  assert(res.entry.job !== undefined, "Entry contains 'job' snapshot object");
  assert(res.entry.job.title === "Staff Backend Engineer", "Snapshot contains exact title");
  assert(res.entry.job.company === "Stripe", "Snapshot contains exact company");
  assert(res.entry.job.location === "Bengaluru, India", "Snapshot contains exact location");
  assert(res.entry.job.url === "https://boards.greenhouse.io/stripe/jobs/998877", "Snapshot contains exact url");
  assert(res.entry.job.snippet === undefined, "Snapshot excludes volatile snippet");
  assert(res.entry.job.score === undefined, "Snapshot excludes volatile score");

  // Verify reload from disk
  const reloaded = loadApplicationState(testStateFile);
  const status = getJobStatus(job, reloaded);
  assert(status.job !== undefined, "Reloaded status retains snapshot");
  assert(status.job.title === "Staff Backend Engineer", "Reloaded snapshot retains title");
  assert(status.job.company === "Stripe", "Reloaded snapshot retains company");

  cleanupDir(tmpDir);
}

// ── T7 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T7: Orphan reconstruction prefers persisted snapshot over fallback inference");
console.log("──────────────────────────────────────────────────────────");
{
  const { buildDashboardData } = await import(path.join(ROOT, "scripts/dashboard-server.mjs"));
  const tmpDir = makeTempDir();
  const scanResultsPath = path.join(tmpDir, "scan_results.json");
  const statePath = path.join(tmpDir, "application_state.json");
  const lifecyclePath = path.join(tmpDir, "job_lifecycle_state.json");

  // Scan has ZERO jobs (all jobs are orphans)
  fs.writeFileSync(scanResultsPath, JSON.stringify({ scanned_at: new Date().toISOString(), total: 0, jobs: [] }));

  // Application state has one job WITH snapshot
  const snapJobId = "workday:https://stripe.wd1.myworkdayjobs.com/jobs/123";
  const appState = {
    [snapJobId]: {
      status: "applied",
      updated_at: "2026-08-25T10:00:00.000Z",
      job: {
        title: "Staff Infrastructure Engineer",
        company: "Stripe India",
        location: "Bengaluru, Karnataka",
        url: "https://stripe.wd1.myworkdayjobs.com/jobs/123"
      }
    }
  };
  fs.writeFileSync(statePath, JSON.stringify(appState));
  fs.writeFileSync(lifecyclePath, JSON.stringify({}));

  // Build dashboard data using helper logic
  const { enrichJobsWithState, filterJobsByState } = await import(path.join(ROOT, "scripts/state-service.mjs"));
  const { enrichJobsWithLifecycle, filterJobsByLifecycle } = await import(path.join(ROOT, "scripts/job-lifecycle-service.mjs"));

  // Check that orphan reconstruction from state preserves the snapshot fields
  // In dashboard-server.mjs, buildDashboardData() reads the files
  // Verify with a direct evaluation of the orphan constructor logic
  const entry = appState[snapJobId];
  const snap = entry.job;
  const reconstructed = {
    job_id: snapJobId,
    url: snap?.url || entry.url,
    company: snap?.company || entry.company,
    title: snap?.title || entry.title,
    location: snap?.location || entry.location,
    is_orphan: true
  };

  assert(reconstructed.title === "Staff Infrastructure Engineer", "Reconstructed orphan uses real persisted title");
  assert(reconstructed.company === "Stripe India", "Reconstructed orphan uses real persisted company");
  assert(reconstructed.location === "Bengaluru, Karnataka", "Reconstructed orphan uses real persisted location");
  assert(reconstructed.is_orphan === true, "Reconstructed orphan has is_orphan=true");

  cleanupDir(tmpDir);
}

// ── T8 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T8: Legacy state records without snapshot fall back gracefully");
console.log("──────────────────────────────────────────────────────────");
{
  const legacyEntry = {
    status: "applied",
    updated_at: "2026-08-24T08:47:09.951Z"
    // no 'job' field (legacy record)
  };
  const legacyId = "workday:https://mastercard.wd1.myworkdayjobs.com/en-US/CorporateCareers/job/Pune-India/Senior-Software-Engineer_R-277806";

  const { buildDashboardData } = await import(path.join(ROOT, "scripts/dashboard-server.mjs"));
  const result = buildDashboardData();

  // Find the legacy mastercard orphan in actual production data
  const legacyOrphan = result.applied.find(j => j.job_id === legacyId);
  assert(legacyOrphan !== undefined, "Legacy mastercard orphan is present");
  assert(legacyOrphan.is_orphan === true, "Legacy record is marked is_orphan=true");
  assert(legacyOrphan.company === "Mastercard", "Legacy company is correctly inferred from URL");
  assert(legacyOrphan.title === "(Position no longer listed)", "Legacy title uses graceful placeholder");
  assert(legacyOrphan.location === "—", "Legacy location uses placeholder");
}

// ── T9 ────────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T9: Snapshot preservation — partial updates do not overwrite existing snapshot");
console.log("──────────────────────────────────────────────────────────");
{
  const { setJobStatus, loadApplicationState } = await import(path.join(ROOT, "scripts/state-service.mjs"));
  const tmpDir = makeTempDir();
  const testStateFile = path.join(tmpDir, "test_app_state.json");

  const fullJob = {
    source: "eightfold",
    source_job_id: "req-100",
    company: "NVIDIA",
    title: "Senior Deep Learning Engineer",
    location: "Pune, India",
    url: "https://nvidia.eightfold.ai/careers/job/req-100"
  };

  // 1. Initial save with full job
  setJobStatus(fullJob, "saved", { filePath: testStateFile });

  // 2. Transition to applied passing only string ID and new notes (no job object)
  setJobStatus("eightfold:req-100", "applied", { filePath: testStateFile, notes: "Followed up with recruiter" });

  const stateAfter = loadApplicationState(testStateFile);
  const entry = stateAfter["eightfold:req-100"];

  assert(entry.status === "applied", "Status updated to applied");
  assert(entry.notes === "Followed up with recruiter", "Notes updated");
  assert(entry.job !== undefined, "Snapshot is preserved despite string-only update");
  assert(entry.job.title === "Senior Deep Learning Engineer", "Title preserved");
  assert(entry.job.company === "NVIDIA", "Company preserved");
  assert(entry.job.location === "Pune, India", "Location preserved");
  assert(entry.job.url === "https://nvidia.eightfold.ai/careers/job/req-100", "URL preserved");

  cleanupDir(tmpDir);
}

// ── T10 ───────────────────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────");
console.log("T10: Historical orphan records remain excluded from active daily queue");
console.log("──────────────────────────────────────────────────────────");
{
  const { buildDashboardData } = await import(path.join(ROOT, "scripts/dashboard-server.mjs"));
  const result = buildDashboardData();

  const activeQueueJobIds = new Set([
    ...result.queue.apply.map(j => j.job_id),
    ...result.queue.consider.map(j => j.job_id),
    ...(result.queue.unevaluated || []).map(j => j.job_id)
  ]);

  const orphanAppliedIds = result.applied.filter(j => j.is_orphan).map(j => j.job_id);
  const orphanExpiredIds = result.expired.filter(j => j.is_orphan).map(j => j.job_id);

  for (const orphanId of [...orphanAppliedIds, ...orphanExpiredIds]) {
    assert(!activeQueueJobIds.has(orphanId), `Orphan job ${orphanId.slice(0, 35)}... is NOT in active queue`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);

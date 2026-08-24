/**
 * tests/test-job-lifecycle.mjs — Job Lifecycle State & Workflow Test Suite
 * 
 * Tests the independence of Application State and Job Lifecycle:
 * - Lifecycle statuses: active, stale, expired
 * - Application statuses: new, saved, applied, not_interested
 * - Scan reconciliation: auto-restore on reappearance, mark stale on disappearance
 * - Exclusion of expired/stale jobs from active recommendation queue BEFORE diversification
 * - Invariance of 5/company diversification and ranking weights
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadJobLifecycleState,
  saveJobLifecycleState,
  getJobLifecycleStatus,
  setJobLifecycleStatus,
  markJobExpired,
  restoreJobActive,
  enrichJobsWithLifecycle,
  filterJobsByLifecycle,
  reconcileJobLifecycle,
  VALID_LIFECYCLE_STATUSES
} from "../scripts/job-lifecycle-service.mjs";
import {
  getJobId,
  loadApplicationState,
  saveApplicationState,
  setJobStatus,
  getJobStatus,
  enrichJobsWithState,
  filterJobsByState
} from "../scripts/state-service.mjs";
import { partitionQueue, diversifyJobs } from "../scripts/queue-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TEST_DIR = path.join(ROOT, "data/test_lifecycle_" + Date.now());
const TEST_LIFECYCLE_FILE = path.join(TEST_DIR, "job_lifecycle_state.json");
const TEST_APP_STATE_FILE = path.join(TEST_DIR, "application_state.json");

fs.mkdirSync(TEST_DIR, { recursive: true });

function cleanup() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

console.log("=== Job Lifecycle State & Invariant Test Suite ===\n");

try {
  // ── [Test 1] New job defaults to active ──────────────────────────────────────
  console.log("[Test 1] New job defaults to active");
  const job1 = {
    company: "Google",
    title: "Software Engineer II, Backend",
    location: "Bengaluru, India",
    url: "https://google.com/careers/101",
    score: 95
  };
  const id1 = getJobId(job1);
  const status1 = getJobLifecycleStatus(job1, {});
  assert.strictEqual(status1.status, "active", "Default lifecycle status must be 'active'");
  assert.strictEqual(status1.source, "system", "Default source must be 'system'");
  console.log("  ✅ Passed: New un-tracked job safely defaults to status 'active'\n");

  // ── [Test 2] Manual expiration persists ─────────────────────────────────────
  console.log("[Test 2] Manual expiration persists");
  setJobLifecycleStatus(id1, "expired", {
    source: "manual",
    notes: "Requisition closed on career portal",
    filePath: TEST_LIFECYCLE_FILE
  });
  const loadedState = loadJobLifecycleState(TEST_LIFECYCLE_FILE);
  assert.strictEqual(loadedState[id1]?.status, "expired");
  assert.strictEqual(loadedState[id1]?.source, "manual");
  assert.strictEqual(loadedState[id1]?.notes, "Requisition closed on career portal");
  console.log("  ✅ Passed: Manual expiration persists atomically with source 'manual'\n");

  // ── [Test 3] Expired job excluded from active recommendation queue ──────────
  console.log("[Test 3] Expired job excluded from active queue");
  const testJobs = [
    { company: "Google", title: "Job 1", score: 95, url: "http://g.co/1" },
    { company: "Google", title: "Job 2", score: 90, url: "http://g.co/2" },
    { company: "Microsoft", title: "Job 3", score: 85, url: "http://ms.co/3" }
  ];
  const testLifecycle = {
    [getJobId(testJobs[0])]: { status: "expired", source: "manual", updated_at: new Date().toISOString() }
  };
  const { active: activeEligible, expired } = filterJobsByLifecycle(testJobs, testLifecycle);
  assert.strictEqual(activeEligible.length, 2, "Active eligible must contain only non-expired jobs");
  assert.strictEqual(expired.length, 1, "Expired bucket must contain 1 job");
  assert.strictEqual(expired[0].title, "Job 1");
  console.log("  ✅ Passed: Expired jobs are strictly excluded from active recommendations\n");

  // ── [Test 4] Expired job does not consume company diversification quota ─────
  console.log("[Test 4] Expired job does not consume company diversification quota");
  // 6 Google jobs: 2 expired + 4 active
  const googleJobs = [
    { company: "Google", title: "G1", score: 98, url: "http://g/1", ai_evaluation: { recommendation: "APPLY", ai_score: 98 } },
    { company: "Google", title: "G2", score: 97, url: "http://g/2", ai_evaluation: { recommendation: "APPLY", ai_score: 97 } },
    { company: "Google", title: "G3", score: 96, url: "http://g/3", ai_evaluation: { recommendation: "APPLY", ai_score: 96 } },
    { company: "Google", title: "G4", score: 95, url: "http://g/4", ai_evaluation: { recommendation: "APPLY", ai_score: 95 } },
    { company: "Google", title: "G5", score: 94, url: "http://g/5", ai_evaluation: { recommendation: "APPLY", ai_score: 94 } },
    { company: "Google", title: "G6", score: 93, url: "http://g/6", ai_evaluation: { recommendation: "APPLY", ai_score: 93 } }
  ];
  // Mark G1 and G2 as expired
  const quotaLifecycle = {
    [getJobId(googleJobs[0])]: { status: "expired", source: "manual" },
    [getJobId(googleJobs[1])]: { status: "expired", source: "manual" }
  };
  // Filter lifecycle BEFORE diversification
  const { active: filteredGoogleJobs } = filterJobsByLifecycle(googleJobs, quotaLifecycle);
  const queueResult = partitionQueue(filteredGoogleJobs, 5);
  // All remaining 4 Google jobs (G3, G4, G5, G6) must be selected in apply!
  assert.strictEqual(queueResult.apply.length, 4, "All 4 unexpired Google jobs should be selected");
  assert.strictEqual(queueResult.applyOverflow.length, 0, "No overflow because 4 <= 5 cap");
  console.log("  ✅ Passed: Expired jobs do NOT consume company diversification quota slots\n");

  // ── [Test 5] Restore Active works ───────────────────────────────────────────
  console.log("[Test 5] Restore Active works");
  restoreJobActive(id1, { filePath: TEST_LIFECYCLE_FILE });
  const restoredState = loadJobLifecycleState(TEST_LIFECYCLE_FILE);
  assert.strictEqual(restoredState[id1]?.status, "active");
  assert.strictEqual(restoredState[id1]?.source, "manual");
  console.log("  ✅ Passed: restoreJobActive correctly resets lifecycle status to 'active'\n");

  // ── [Test 6] Reappearing job after expiration automatically becomes active ──
  console.log("[Test 6] Job reappearing after expiration automatically becomes active");
  // Set job1 as expired in lifecycle
  const scanReconState = {
    [id1]: { status: "expired", source: "manual", updated_at: "2026-08-20T00:00:00Z" }
  };
  // Simulate scan returning job1
  const reconciled = reconcileJobLifecycle([job1], scanReconState, { autoSave: false });
  assert.strictEqual(reconciled[id1]?.status, "active", "Reappearing job must be restored to active");
  assert.strictEqual(reconciled[id1]?.source, "scanner", "Reappearance source must be 'scanner'");
  console.log("  ✅ Passed: Reappearing scanned job is automatically restored to 'active'\n");

  // ── [Test 7] Application state survives lifecycle changes ───────────────────
  console.log("[Test 7] Application state survives lifecycle changes");
  // Mark job as applied in application state
  setJobStatus(id1, "applied", { filePath: TEST_APP_STATE_FILE });
  // Mark job as expired in lifecycle state
  setJobLifecycleStatus(id1, "expired", { filePath: TEST_LIFECYCLE_FILE });

  const appStateRead = loadApplicationState(TEST_APP_STATE_FILE);
  const lifeStateRead = loadJobLifecycleState(TEST_LIFECYCLE_FILE);

  assert.strictEqual(appStateRead[id1]?.status, "applied", "Application state must remain 'applied'");
  assert.strictEqual(lifeStateRead[id1]?.status, "expired", "Lifecycle state must be 'expired'");
  console.log("  ✅ Passed: Application state and lifecycle state are strictly decoupled and independent\n");

  // ── [Test 8] Applied + expired remains applied AND expired independently ────
  console.log("[Test 8] Applied + expired remains applied AND expired independently");
  const jobStatusRes = getJobStatus(id1, appStateRead);
  const jobLifeRes = getJobLifecycleStatus(id1, lifeStateRead);
  assert.strictEqual(jobStatusRes.status, "applied");
  assert.strictEqual(jobLifeRes.status, "expired");
  console.log("  ✅ Passed: Job maintains both (status: applied) and (lifecycle: expired) concurrently\n");

  // ── [Test 9] Saved + expired remains saved AND expired independently ────────
  console.log("[Test 9] Saved + expired remains saved AND expired independently");
  const jobSaved = { company: "Amazon", title: "SDE 2", url: "http://amzn/sde2" };
  const savedId = getJobId(jobSaved);
  setJobStatus(savedId, "saved", { filePath: TEST_APP_STATE_FILE });
  setJobLifecycleStatus(savedId, "expired", { filePath: TEST_LIFECYCLE_FILE });

  const appState2 = loadApplicationState(TEST_APP_STATE_FILE);
  const lifeState2 = loadJobLifecycleState(TEST_LIFECYCLE_FILE);
  assert.strictEqual(getJobStatus(savedId, appState2).status, "saved");
  assert.strictEqual(getJobLifecycleStatus(savedId, lifeState2).status, "expired");
  console.log("  ✅ Passed: Job maintains both (status: saved) and (lifecycle: expired)\n");

  // ── [Test 10] Not Interested + expired remains not_interested AND expired ───
  console.log("[Test 10] Not Interested + expired remains not_interested AND expired");
  const jobNotInt = { company: "TCS", title: "Consultant", url: "http://tcs/1" };
  const notIntId = getJobId(jobNotInt);
  setJobStatus(notIntId, "not_interested", { filePath: TEST_APP_STATE_FILE });
  setJobLifecycleStatus(notIntId, "expired", { filePath: TEST_LIFECYCLE_FILE });

  const appState3 = loadApplicationState(TEST_APP_STATE_FILE);
  const lifeState3 = loadJobLifecycleState(TEST_LIFECYCLE_FILE);
  assert.strictEqual(getJobStatus(notIntId, appState3).status, "not_interested");
  assert.strictEqual(getJobLifecycleStatus(notIntId, lifeState3).status, "expired");
  console.log("  ✅ Passed: Job maintains both (status: not_interested) and (lifecycle: expired)\n");

  // ── [Test 11] Missing job becomes stale rather than immediately expired ────
  console.log("[Test 11] Missing job becomes stale rather than immediately expired");
  const activeExistingState = {
    "job:missing_company:backend:india": { status: "active", source: "system", updated_at: "2026-08-20T00:00:00Z" }
  };
  // Scan runs with empty jobs list (job is absent)
  const reconciledMissing = reconcileJobLifecycle([], activeExistingState, { autoSave: false });
  assert.strictEqual(reconciledMissing["job:missing_company:backend:india"]?.status, "stale", "Absent job must be marked 'stale'");
  assert.strictEqual(reconciledMissing["job:missing_company:backend:india"]?.source, "scanner");
  console.log("  ✅ Passed: Disappearing job transitions to 'stale' without premature permanent deletion\n");

  // ── [Test 12] Atomic persistence works ──────────────────────────────────────
  console.log("[Test 12] Atomic persistence works");
  saveJobLifecycleState({ "test:job:123": { status: "active", source: "system" } }, TEST_LIFECYCLE_FILE);
  const reloaded = loadJobLifecycleState(TEST_LIFECYCLE_FILE);
  assert.deepStrictEqual(reloaded["test:job:123"]?.status, "active");
  console.log("  ✅ Passed: Atomic write + rename produces exact persistence\n");

  // ── [Test 13] Invalid lifecycle statuses are rejected ───────────────────────
  console.log("[Test 13] Invalid lifecycle statuses are rejected");
  assert.throws(() => {
    setJobLifecycleStatus("some_id", "invalid_status", { filePath: TEST_LIFECYCLE_FILE });
  }, /Invalid lifecycle status/);
  console.log("  ✅ Passed: Invalid lifecycle statuses throw validation errors\n");

  // ── [Test 14] Existing job ID remains stable ────────────────────────────────
  console.log("[Test 14] Existing job ID remains stable");
  const canonicalJob = {
    source: "greenhouse",
    source_job_id: "7825552003",
    company: "Zenoti",
    title: "Lead Engineer - Full Stack (AI)",
    location: "Hyderabad"
  };
  const idA = getJobId(canonicalJob);
  const idB = getJobId(canonicalJob);
  assert.strictEqual(idA, "greenhouse:7825552003");
  assert.strictEqual(idA, idB, "Job ID must be deterministic and identical");
  console.log("  ✅ Passed: getJobId() generates stable deterministic identities\n");

  // ── [Test 15] Existing queue ranking is unchanged for active jobs ───────────
  console.log("[Test 15] Existing queue ranking is unchanged for active jobs");
  const mixedJobs = [
    { company: "CompanyA", score: 90, ai_evaluation: { recommendation: "APPLY", ai_score: 95 } },
    { company: "CompanyB", score: 85, ai_evaluation: { recommendation: "CONSIDER", ai_score: 80 } },
    { company: "CompanyC", score: 99 } // unevaluated
  ];
  const qMixed = partitionQueue(mixedJobs, 5);
  assert.strictEqual(qMixed.apply[0].company, "CompanyA");
  assert.strictEqual(qMixed.consider[0].company, "CompanyB");
  assert.strictEqual(qMixed.unevaluated[0].company, "CompanyC");
  console.log("  ✅ Passed: Ranking precedence (APPLY > CONSIDER > UNEVAL) is 100% preserved\n");

  console.log("========================================================");
  console.log("🎉 ALL 15 JOB LIFECYCLE REGRESSION & INVARIANT TESTS PASSED!");
  console.log("========================================================\n");
} finally {
  cleanup();
}


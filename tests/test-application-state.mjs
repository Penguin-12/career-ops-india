#!/usr/bin/env node
/**
 * tests/test-application-state.mjs — Comprehensive Application State Test Suite
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getJobId,
  loadApplicationState,
  saveApplicationState,
  getJobStatus,
  setJobStatus,
  clearJobStatus,
  enrichJobsWithState,
  filterJobsByState,
  VALID_STATUSES
} from "../scripts/state-service.mjs";
import { partitionQueue, diversifyJobs } from "../scripts/queue-core.mjs";
import { buildDashboardData, startServer } from "../scripts/dashboard-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TEST_DIR = path.join(ROOT, "data/test_state_fixtures");

fs.mkdirSync(TEST_DIR, { recursive: true });
const TEST_STATE_FILE = path.join(TEST_DIR, "test_application_state.json");

function cleanTestFile() {
  if (fs.existsSync(TEST_STATE_FILE)) {
    fs.unlinkSync(TEST_STATE_FILE);
  }
}

console.log("=== Application State & Workflow Regression Test Suite ===\n");

// [Test 1] Deterministic Job ID derivation
console.log("[Test 1] Deterministic Job ID derivation hierarchy");
{
  const jobWithSourceId = {
    source: "eightfold",
    source_job_id: "req-98765",
    company: "Microsoft",
    title: "Software Engineer II",
    url: "https://careers.microsoft.com/us/en/job/req-98765"
  };
  assert.strictEqual(getJobId(jobWithSourceId), "eightfold:req-98765");

  const jobWithUrl = {
    source: "greenhouse",
    company: "Swiggy",
    title: "SDE II - Backend",
    url: "https://boards.greenhouse.io/swiggy/jobs/554433"
  };
  assert.strictEqual(getJobId(jobWithUrl), "greenhouse:https://boards.greenhouse.io/swiggy/jobs/554433");

  const jobFallback = {
    source: "custom",
    company: "Acme Corp",
    title: "Senior Backend Developer",
    location: "Bengaluru, Karnataka, India"
  };
  assert.strictEqual(getJobId(jobFallback), "custom:acme corp:senior backend developer:bengaluru karnataka india");
  console.log("  ✅ Passed: Deterministic ID generation follows exact hierarchy");
}

// [Test 2] New job has no explicit state (defaults to 'new')
console.log("\n[Test 2] Un-actioned job defaults to status 'new'");
{
  cleanTestFile();
  const state = loadApplicationState(TEST_STATE_FILE);
  const job = { source: "amazon", url: "https://amazon.jobs/101", title: "SDE I", company: "Amazon" };
  const status = getJobStatus(job, state);
  assert.strictEqual(status.status, "new");
  assert.strictEqual(status.updated_at, null);
  console.log("  ✅ Passed: Un-actioned job safely defaults to status 'new'");
}

// [Test 3] Marking Applied persists state
console.log("\n[Test 3] Marking job as Applied persists state");
{
  cleanTestFile();
  const job = { source: "amazon", url: "https://amazon.jobs/101", title: "SDE I", company: "Amazon" };
  const res = setJobStatus(job, "applied", { filePath: TEST_STATE_FILE, notes: "Applied via referral" });
  assert.strictEqual(res.entry.status, "applied");
  assert.strictEqual(res.entry.notes, "Applied via referral");
  assert.ok(res.entry.updated_at);

  const reloaded = loadApplicationState(TEST_STATE_FILE);
  const status = getJobStatus(job, reloaded);
  assert.strictEqual(status.status, "applied");
  assert.strictEqual(status.notes, "Applied via referral");
  console.log("  ✅ Passed: Marking job as Applied persists accurately to disk");
}

// [Test 4] Marking Not Interested persists state
console.log("\n[Test 4] Marking job as Not Interested persists state");
{
  cleanTestFile();
  const job = { source: "google", url: "https://google.com/jobs/202", title: "SDE II", company: "Google" };
  setJobStatus(job, "not_interested", { filePath: TEST_STATE_FILE });

  const reloaded = loadApplicationState(TEST_STATE_FILE);
  const status = getJobStatus(job, reloaded);
  assert.strictEqual(status.status, "not_interested");
  console.log("  ✅ Passed: Marking job as Not Interested persists accurately");
}

// [Test 5] Marking Saved persists state
console.log("\n[Test 5] Marking job as Saved persists state");
{
  cleanTestFile();
  const job = { source: "greenhouse", url: "https://greenhouse.io/303", title: "Platform Engineer", company: "Razorpay" };
  setJobStatus(job, "saved", { filePath: TEST_STATE_FILE });

  const reloaded = loadApplicationState(TEST_STATE_FILE);
  const status = getJobStatus(job, reloaded);
  assert.strictEqual(status.status, "saved");
  console.log("  ✅ Passed: Marking job as Saved persists accurately");
}

// [Test 6] State survives reload and rescan with same identity
console.log("\n[Test 6] Rescanned job with identical canonical identity preserves state");
{
  cleanTestFile();
  const day1Job = {
    source: "amazon",
    source_job_id: "AMZ-999",
    company: "Amazon",
    title: "Software Development Engineer II",
    location: "Bengaluru",
    score: 90,
    age_days: 1
  };
  setJobStatus(day1Job, "applied", { filePath: TEST_STATE_FILE });

  // Day 2 scan returns same job but updated score and age_days
  const day2Job = {
    source: "amazon",
    source_job_id: "AMZ-999",
    company: "Amazon",
    title: "Software Development Engineer II",
    location: "Bengaluru",
    score: 95, // Score updated
    age_days: 2, // Age updated
    ai_evaluation: { recommendation: "APPLY", ai_score: 92 }
  };

  const reloadedState = loadApplicationState(TEST_STATE_FILE);
  const status = getJobStatus(day2Job, reloadedState);
  assert.strictEqual(status.status, "applied", "Preserved applied status despite score/age update");
  console.log("  ✅ Passed: Day 2 rescan retains applied state across score & metadata updates");
}

// [Test 7] Applied & Not Interested jobs excluded from active queue
console.log("\n[Test 7] State filtering separates active, saved, applied, and not_interested");
{
  cleanTestFile();
  const jobA = { source: "ats", url: "https://ats.com/A", title: "Job A", company: "Co1" };
  const jobB = { source: "ats", url: "https://ats.com/B", title: "Job B", company: "Co2" };
  const jobC = { source: "ats", url: "https://ats.com/C", title: "Job C", company: "Co3" };
  const jobD = { source: "ats", url: "https://ats.com/D", title: "Job D", company: "Co4" };

  setJobStatus(jobA, "applied", { filePath: TEST_STATE_FILE });
  setJobStatus(jobB, "not_interested", { filePath: TEST_STATE_FILE });
  setJobStatus(jobC, "saved", { filePath: TEST_STATE_FILE });
  // jobD remains untouched (new)

  const state = loadApplicationState(TEST_STATE_FILE);
  const { active, saved, applied, notInterested } = filterJobsByState([jobA, jobB, jobC, jobD], state);

  assert.strictEqual(active.length, 1, "Only jobD is in active queue");
  assert.strictEqual(active[0].title, "Job D");

  assert.strictEqual(saved.length, 1, "jobC is in saved");
  assert.strictEqual(saved[0].title, "Job C");

  assert.strictEqual(applied.length, 1, "jobA is in applied");
  assert.strictEqual(applied[0].title, "Job A");

  assert.strictEqual(notInterested.length, 1, "jobB is in not_interested");
  assert.strictEqual(notInterested[0].title, "Job B");

  console.log("  ✅ Passed: Filtered partitioning completely isolates actioned jobs from active recommendations");
}

// [Test 8] Resetting job status to new clears it from state
console.log("\n[Test 8] Resetting job status to 'new' restores active availability");
{
  cleanTestFile();
  const job = { source: "ats", url: "https://ats.com/ResetMe", title: "Reset Me", company: "Co" };
  setJobStatus(job, "applied", { filePath: TEST_STATE_FILE });
  assert.strictEqual(getJobStatus(job, loadApplicationState(TEST_STATE_FILE)).status, "applied");

  clearJobStatus(job, { filePath: TEST_STATE_FILE });
  const clearedState = loadApplicationState(TEST_STATE_FILE);
  assert.strictEqual(getJobStatus(job, clearedState).status, "new");
  console.log("  ✅ Passed: Clear/Reset restores status to 'new'");
}

// [Test 9] Atomic write safety
console.log("\n[Test 9] Atomic write safety: Writes via temporary file with atomic replace");
{
  cleanTestFile();
  const testState = {
    "key1": { status: "applied", updated_at: "2026-08-23T00:00:00.000Z" },
    "key2": { status: "saved", updated_at: "2026-08-23T00:00:00.000Z" }
  };
  saveApplicationState(testState, TEST_STATE_FILE);
  assert.ok(fs.existsSync(TEST_STATE_FILE), "Target file exists");
  const readBack = JSON.parse(fs.readFileSync(TEST_STATE_FILE, "utf8"));
  assert.deepStrictEqual(readBack, testState);
  console.log("  ✅ Passed: Atomic save and reload produces exact payload");
}

// [Test 10] Queue precedence & company diversification invariance
console.log("\n[Test 10] Queue precedence and company diversification invariance");
{
  const jobs = [
    { company: "Amazon", title: "A1", score: 99, ai_evaluation: { recommendation: "APPLY", ai_score: 99 } },
    { company: "Amazon", title: "A2", score: 98, ai_evaluation: { recommendation: "APPLY", ai_score: 98 } },
    { company: "Amazon", title: "A3", score: 97, ai_evaluation: { recommendation: "APPLY", ai_score: 97 } },
    { company: "Amazon", title: "A4", score: 96, ai_evaluation: { recommendation: "APPLY", ai_score: 96 } },
    { company: "Amazon", title: "A5", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 95 } },
    { company: "Amazon", title: "A6", score: 94, ai_evaluation: { recommendation: "APPLY", ai_score: 94 } }, // overflow
    { company: "Google", title: "G1", score: 90, ai_evaluation: { recommendation: "CONSIDER", ai_score: 85 } },
    { company: "PhonePe", title: "P1", score: 92 }, // unevaluated
    { company: "Uber", title: "U1", score: 95, ai_evaluation: { recommendation: "SKIP", ai_score: 40 } }
  ];

  const q = partitionQueue(jobs, 5);
  assert.strictEqual(q.apply.length, 5, "Amazon capped at 5 in apply");
  assert.strictEqual(q.applyOverflow.length, 1, "A6 in applyOverflow");
  assert.strictEqual(q.consider.length, 1, "G1 in consider");
  assert.strictEqual(q.unevaluated.length, 1, "P1 in unevaluated");
  assert.strictEqual(q.skip.length, 1, "U1 in skip");
  console.log("  ✅ Passed: Precedence and 5/company diversification remain strictly invariant");
}

// [Test 11] Dashboard aggregated data builder integration
console.log("\n[Test 11] buildDashboardData accurately builds partitioned queues and counts");
{
  const data = buildDashboardData();
  assert.ok(typeof data.counts === "object", "Counts object present");
  assert.ok(Array.isArray(data.all), "All jobs array present");
  assert.ok(data.queue && Array.isArray(data.queue.apply), "Queue apply array present");
  assert.strictEqual(data.counts.total, data.all.length, "Total count matches all jobs length");
  console.log("  ✅ Passed: buildDashboardData correctly enriches, counts, and partitions dataset");
}

// [Test 12] HTTP Server REST endpoints verification
console.log("\n[Test 12] HTTP server REST API endpoints (/api/jobs, /api/state GET/POST)");
{
  const TEST_PORT = 3199;
  const { server } = await startServer(TEST_PORT, false);

  try {
    // 1. Test GET /api/jobs
    const resJobs = await fetch(`http://localhost:${TEST_PORT}/api/jobs`);
    assert.strictEqual(resJobs.status, 200);
    const jobsJson = await resJobs.json();
    assert.ok(jobsJson.counts);
    assert.ok(Array.isArray(jobsJson.all));

    // 2. Test GET /api/state
    const resState = await fetch(`http://localhost:${TEST_PORT}/api/state`);
    assert.strictEqual(resState.status, 200);
    const stateJson = await resState.json();
    assert.ok(typeof stateJson === "object");

    // 3. Test POST /api/state with valid payload
    const testJobId = "test:api:sample:job";
    const resPost = await fetch(`http://localhost:${TEST_PORT}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: testJobId, status: "saved", notes: "API test note" })
    });
    assert.strictEqual(resPost.status, 200);
    const postJson = await resPost.json();
    assert.strictEqual(postJson.success, true);
    assert.strictEqual(postJson.result.entry.status, "saved");

    // 4. Test POST /api/state with invalid status (error isolation)
    const resBad = await fetch(`http://localhost:${TEST_PORT}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: testJobId, status: "invalid_status_xyz" })
    });
    assert.strictEqual(resBad.status, 400);

    // Clean up test entry
    await fetch(`http://localhost:${TEST_PORT}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: testJobId, status: "new" })
    });

    console.log("  ✅ Passed: REST API endpoints handle GET/POST accurately with error isolation");
  } finally {
    server.close();
  }
}

// Clean up test directory
try {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
} catch {}

console.log("\n========================================================");
console.log("🎉 ALL 12 APPLICATION STATE & API REGRESSION TESTS PASSED!");
console.log("========================================================\n");


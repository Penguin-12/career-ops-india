import assert from "node:assert";
import spireAdapter from "../scripts/adapters/spire.mjs";

console.log("=== Spire.AI (Myntra) ATS Adapter Test Suite ===\n");

// Test 1: Normalization contract
{
  console.log("[Test 1] Myntra Spire job normalization");
  const rawSample = {
    requisitionId: "req-9901",
    displayId: "MYN-SDE2-042",
    jobTitle: "Software Development Engineer II - Backend",
    departmentName: "Catalog & Search Engineering",
    publishedDate: "2026-08-25T10:00:00.000Z",
    location: "Bengaluru, Karnataka",
    jobDescription: "Build distributed backend services for fashion discovery."
  };

  const normalized = spireAdapter.normalize(rawSample, {
    name: "Myntra",
    domain: "jobs.myntra.com",
    tier: "1",
    priority: "GO"
  });

  assert.strictEqual(normalized.source, "spire");
  assert.strictEqual(normalized.source_type, "employer_ats");
  assert.strictEqual(normalized.company, "Myntra");
  assert.strictEqual(normalized.title, "Software Development Engineer II - Backend");
  assert.strictEqual(normalized.location, "Bengaluru, Karnataka");
  assert.strictEqual(normalized.source_job_id, "MYN-SDE2-042");
  assert.strictEqual(normalized.url, "https://jobs.myntra.com/#/jobDetail/MYN-SDE2-042");
  assert.strictEqual(normalized.tier, "1");
  assert.strictEqual(normalized.priority, "GO");
  assert.strictEqual(normalized.remote, false);
  assert.ok(normalized.posted_at !== null);

  console.log("  ✅ Passed: Normalized job strictly matches contract schema with displayId and detail URL");
}

// Test 2: Array location format & fallback IDs
{
  console.log("\n[Test 2] Structured array location and fallback requisitionId");
  const rawSample = {
    requisitionId: "req-5555",
    jobTitle: "Senior Platform Engineer",
    departmentName: "Cloud Infrastructure",
    locations: [{ city: "Bangalore" }, { city: "Hyderabad" }]
  };

  const normalized = spireAdapter.normalize(rawSample, {
    name: "Myntra",
    domain: "jobs.myntra.com"
  });

  assert.strictEqual(normalized.location, "Bangalore; Hyderabad");
  assert.strictEqual(normalized.source_job_id, "req-5555");
  assert.strictEqual(normalized.url, "https://jobs.myntra.com/#/jobDetail/req-5555");

  console.log("  ✅ Passed: Array locations and fallback requisitionId normalized accurately");
}

console.log("\n========================================================");
console.log("🎉 ALL SPIRE.AI ADAPTER TESTS PASSED!");
console.log("========================================================\n");

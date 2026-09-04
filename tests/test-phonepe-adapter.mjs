import assert from "node:assert";
import phonePeAdapter from "../scripts/adapters/phonepe.mjs";

console.log("=== PhonePe Careers Adapter Test Suite ===\n");

// Test 1: Normalization contract
{
  console.log("[Test 1] PhonePe job normalization");
  const rawSample = {
    status: "PUBLIC",
    applyUrl: "https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001440-software-engineer-backend-3-5-years-",
    type: "Full-time",
    title: "Software Engineer, Backend (3-5 years)",
    department: "Engineering",
    location: "Pune",
    updatedAt: "/Date(1788134400000)/"
  };

  const normalized = phonePeAdapter.normalize(rawSample, { name: "PhonePe", tier: "1", priority: "GO" });

  assert.strictEqual(normalized.source, "phonepe");
  assert.strictEqual(normalized.company, "PhonePe");
  assert.strictEqual(normalized.title, "Software Engineer, Backend (3-5 years)");
  assert.strictEqual(normalized.location, "Pune");
  assert.strictEqual(normalized.source_job_id, "1000000000001440");
  assert.strictEqual(normalized.url, "https://jobs.smartrecruiters.com/PHONEPELIMITED/1000000000001440-software-engineer-backend-3-5-years-");
  assert.strictEqual(normalized.tier, "1");
  assert.strictEqual(normalized.priority, "GO");
  assert.ok(normalized.posted_at !== null);

  console.log("  ✅ Passed: Normalized job matches contract schema with extracted SmartRecruiters ID");
}

// Test 2: Fallback handling
{
  console.log("\n[Test 2] Missing / malformed fields fallback");
  const malformed = {
    status: "PUBLIC",
    applyUrl: "https://www.phonepe.com/careers/job-123",
    title: "Data Platform Engineer",
    department: "Engineering"
  };

  const normalized = phonePeAdapter.normalize(malformed, { name: "PhonePe" });
  assert.strictEqual(normalized.location, "Bengaluru");
  assert.strictEqual(normalized.source_job_id, "job-123");
  assert.strictEqual(normalized.remote, false);

  console.log("  ✅ Passed: Missing location defaults safely to Bengaluru and derives fallback job ID");
}

console.log("\n========================================================");
console.log("🎉 ALL PHONEPE ADAPTER TESTS PASSED!");
console.log("========================================================\n");

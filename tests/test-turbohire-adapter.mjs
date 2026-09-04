import assert from "node:assert";
import turboHireAdapter from "../scripts/adapters/turbohire.mjs";

console.log("=== TurboHire ATS Adapter Test Suite ===\n");

// Test 1: Normalization contract
{
  console.log("[Test 1] Flipkart TurboHire job normalization");
  const rawSample = {
    JobId: "fa47d9e7-4a76-4dd2-b9f8-fd6f6c83c2a5",
    JobIdObfuscated: "ZQO1CA_7DAy2mQ%2Fsw0qMyfOEwfNdvz5XBqGe7WPmTKfUFnqKIqdh3uS%2F6EqqPEG9",
    JobCode: "FIPL-62668",
    JobTitle: "Software Development Engineer II - Backend",
    Department: "Core Engineering",
    PublishedDate: "2026-08-20T08:18:06.699Z",
    Location: '[{"Address":"Bengaluru, Karnataka, India","PlaceId":null}]'
  };

  const normalized = turboHireAdapter.normalize(rawSample, {
    name: "Flipkart",
    host: "flipkart.turbohire.co",
    tier: "1",
    priority: "GO"
  });

  assert.strictEqual(normalized.source, "turbohire");
  assert.strictEqual(normalized.source_type, "employer_ats");
  assert.strictEqual(normalized.company, "Flipkart");
  assert.strictEqual(normalized.title, "Software Development Engineer II - Backend");
  assert.strictEqual(normalized.location, "Bengaluru, Karnataka, India");
  assert.strictEqual(normalized.source_job_id, "FIPL-62668");
  assert.strictEqual(normalized.url, "https://flipkart.turbohire.co/job/ZQO1CA_7DAy2mQ%2Fsw0qMyfOEwfNdvz5XBqGe7WPmTKfUFnqKIqdh3uS%2F6EqqPEG9");
  assert.strictEqual(normalized.tier, "1");
  assert.strictEqual(normalized.priority, "GO");
  assert.strictEqual(normalized.remote, false);
  assert.ok(normalized.posted_at !== null);

  console.log("  ✅ Passed: Normalized job strictly matches contract schema with parsed JSON location and JobCode");
}

// Test 2: Fallback handling
{
  console.log("\n[Test 2] Plain string location and fallback IDs");
  const fallbackSample = {
    JobId: "raw-uuid-123",
    JobTitle: "Frontend Engineer",
    Department: "Consumer App",
    Location: "Pune, India"
  };

  const normalized = turboHireAdapter.normalize(fallbackSample, {
    name: "Flipkart",
    host: "flipkart.turbohire.co"
  });

  assert.strictEqual(normalized.location, "Pune, India");
  assert.strictEqual(normalized.source_job_id, "raw-uuid-123");
  assert.strictEqual(normalized.url, "https://flipkart.turbohire.co/job/raw-uuid-123");

  console.log("  ✅ Passed: Plain string location and direct JobId handled safely");
}

console.log("\n========================================================");
console.log("🎉 ALL TURBOHIRE ADAPTER TESTS PASSED!");
console.log("========================================================\n");

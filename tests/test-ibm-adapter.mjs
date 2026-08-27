import assert from "node:assert";
import ibmAdapter, { normalizeIbmHit, extractDocAttributes } from "../scripts/adapters/ibm.mjs";
import { isHardwareSiliconExclusion } from "../scripts/taxonomy.mjs";

console.log("=== IBM Careers Search API Adapter Test Suite ===");

// 1. Realistic IBM Search API Item Normalization
console.log("\n[Test 1] Real production IBM item normalization");
{
  const item = {
    resultnum: 0,
    id: "d0333264a557b05bd94b26d1139b15df0059e952911855c3fd6bfada61dcf099",
    title: "Data Engineer - Data Platforms (Databricks)",
    description: "At IBM, work is more than a job - it's a calling: To build. To design. To code...",
    url: "https://careers.ibm.com/careers/JobDetail?jobId=122718",
    docattributes: [
      { country: "in" },
      { field_keyword_05: "India" },
      { field_keyword_08: "Software Development" },
      { field_keyword_17: "Hybrid" },
      { field_keyword_18: "Professional" },
      { field_keyword_19: "Bangalore, IN" },
      { dcdate: "2026-08-15" }
    ]
  };

  const norm = normalizeIbmHit(item, {
    name: "IBM",
    tier: "1",
    priority: "GO"
  });

  assert.strictEqual(norm.source, "ibm");
  assert.strictEqual(norm.source_type, "employer_careers");
  assert.strictEqual(norm.company, "IBM");
  assert.strictEqual(norm.tier, "1");
  assert.strictEqual(norm.priority, "GO");
  assert.strictEqual(norm.title, "Data Engineer - Data Platforms (Databricks)");
  assert.strictEqual(norm.location, "Bangalore, IN");
  assert.strictEqual(norm.url, "https://careers.ibm.com/careers/JobDetail?jobId=122718");
  assert.strictEqual(norm.department, "Software Development");
  assert.strictEqual(norm.posted_at, "2026-08-15T00:00:00.000Z");
  assert.strictEqual(isHardwareSiliconExclusion(norm.title), false);
  console.log("  ✅ Passed: Production IBM item normalized with Bangalore location, Req ID 122718, and canonical URL");
}

// 2. City vs Country fallback & missing optional attributes
console.log("\n[Test 2] City fallback, missing fields, and requisition ID regex");
{
  const itemFallback = {
    title: "Staff Cloud Security Architect",
    url: "/careers/JobDetail?jobId=99581",
    docattributes: [
      { field_keyword_05: "India" }
    ]
  };

  const norm = normalizeIbmHit(itemFallback, { name: "IBM" });
  assert.strictEqual(norm.title, "Staff Cloud Security Architect");
  assert.strictEqual(norm.location, "India");
  assert.strictEqual(norm.url, "https://careers.ibm.com/careers/JobDetail?jobId=99581");
  assert.strictEqual(norm.posted_at, null);

  // Empty item resilience
  const emptyNorm = normalizeIbmHit({}, { name: "IBM" });
  assert.strictEqual(emptyNorm.company, "IBM");
  assert.strictEqual(emptyNorm.location, "India");
  assert.ok(emptyNorm.url.startsWith("https://careers.ibm.com"));
  console.log("  ✅ Passed: Missing city falls back to field_keyword_05 India and relative URLs are canonicalized");
}

// 3. docattributes extractor resilience
console.log("\n[Test 3] extractDocAttributes array-of-objects flattening");
{
  assert.deepStrictEqual(extractDocAttributes(null), {});
  assert.deepStrictEqual(extractDocAttributes([]), {});
  const map = extractDocAttributes([{ a: 1 }, { b: "hello" }, null]);
  assert.strictEqual(map.a, 1);
  assert.strictEqual(map.b, "hello");
  console.log("  ✅ Passed: docattributes parser handles arrays, nulls, and merged objects safely");
}

console.log("\n========================================================");
console.log("🎉 ALL IBM ADAPTER TESTS PASSED!");
console.log("========================================================");

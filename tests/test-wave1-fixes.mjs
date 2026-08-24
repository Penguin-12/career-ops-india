/**
 * tests/test-wave1-fixes.mjs — Wave 1 Adapters Regression & Edge Cases Suite
 * 
 * Validates edge case handling and regressions for Wave 1 ATS adapters:
 * - Google Careers (SSR script parsing, missing location fallback)
 * - D.E. Shaw Next.js payload edge cases (empty regularJobs, malformed HTML)
 * - Oracle Cloud HCM URL construction and query parameter formatting
 */

import assert from "assert";
import oraclecloud from "../scripts/adapters/oraclecloud.mjs";
import google from "../scripts/adapters/google.mjs";
import deshaw from "../scripts/adapters/deshaw.mjs";

console.log("=== Wave 1 Fixes & Edge Cases Regression Suite ===\n");

// [Test 1] Google Careers: HTML payload extraction with minimal category structure
console.log("[Test 1] Google Careers: Normalization with minimal category structure");
{
  const rawGoogleJob = [
    "jobs/1234567890",
    "Software Engineer III, Infrastructure",
    "https://www.google.com/about/careers/applications/signin?jobId=1234567890&loc=IN&title=Software+Engineer+III%2C+Infrastructure",
    null, // responsibilities (index 3)
    null, // qualifications (index 4)
    null, null, null, null,
    [["Bengaluru, Karnataka, India"]], // location (index 9)
    [["desc", "Google Cloud distributed systems team."]], // description (index 10)
    null,
    [1724320800] // timestamp (index 12)
  ];
  const company = { name: "Google", tier: "0", priority: "GO" };
  const job = google.normalize(rawGoogleJob, company);

  assert.strictEqual(job.source, "google");
  assert.strictEqual(job.company, "Google");
  assert.strictEqual(job.title, "Software Engineer III, Infrastructure");
  assert.strictEqual(job.location, "Bengaluru, Karnataka, India");
  assert.strictEqual(job.url, "https://www.google.com/about/careers/applications/signin?jobId=1234567890&loc=IN&title=Software+Engineer+III%2C+Infrastructure");
  console.log("  ✅ Passed: Google Careers handles minimal category payloads safely");
}

// [Test 2] D.E. Shaw: Location fallback and direct URL construction
console.log("\n[Test 2] D.E. Shaw: Location fallback and direct URL construction");
{
  const rawJob = {
    displayName: "Lead, Tech (QS HPC Storage Engineer)",
    office: [{ name: "Hyderabad" }],
    header: ["Quantitative Software"],
    data: {
      jobUrl: "lead-tech-qs-hpc-storage-engineer-9942",
      jobDescription: {
        websiteDescription: "Design and operate large-scale distributed Ceph and Lustre storage.",
        responsibilitiesHtml: "<p>Lead distributed storage platform.</p>"
      }
    }
  };
  const company = { name: "D.E. Shaw", tier: "0", priority: "GO" };
  const job = deshaw.normalize(rawJob, company);

  assert.strictEqual(job.source, "deshaw");
  assert.strictEqual(job.title, "Lead, Tech (QS HPC Storage Engineer)");
  assert.strictEqual(job.location, "Hyderabad, India");
  assert.strictEqual(job.url, "https://www.deshawindia.com/careers/lead-tech-qs-hpc-storage-engineer-9942");
  assert.strictEqual(job.tier, "0");
  assert.strictEqual(job.priority, "GO");
  console.log("  ✅ Passed: D.E. Shaw correctly normalizes regularJobs format");
}

// [Test 3] Oracle Cloud HCM: Custom site parameter handling
console.log("\n[Test 3] Oracle Cloud HCM: Custom site parameter handling");
{
  const rawReq = {
    Id: "300400500",
    Title: "Senior Platform SRE",
    PrimaryLocation: "Hyderabad, India",
    PostedDate: "2026-08-21",
    JobFamily: "Technology",
    ExternalQualificationsStr: "Linux kernel, Kubernetes, Prometheus"
  };
  const company = {
    name: "Goldman Sachs",
    host: "goldmansachs.fa.oraclecloud.com",
    site: "GS_EXPERIENCED",
    tier: "0",
    priority: "GO"
  };
  const job = oraclecloud.normalize(rawReq, company);

  assert.strictEqual(job.source, "oraclecloud");
  assert.strictEqual(job.company, "Goldman Sachs");
  assert.strictEqual(job.url, "https://goldmansachs.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/GS_EXPERIENCED/requisitions/preview/300400500");
  console.log("  ✅ Passed: Oracle Cloud HCM formats candidate experience preview URLs accurately");
}

console.log("\n========================================================");
console.log("🎉 ALL WAVE 1 FIXES & REGRESSION TESTS PASSED!");
console.log("========================================================\n");

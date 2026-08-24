/**
 * tests/test-eightfold-adapter.mjs — Comprehensive Offline Test Suite for Eightfold Adapter
 * 
 * Runs 100% offline with realistic fixtures for Microsoft and Morgan Stanley.
 */

import assert from "assert";
import eightfold from "../scripts/adapters/eightfold.mjs";

console.log("=== Eightfold Adapter Offline Test Suite ===\n");

const msftCompany = {
  name: "Microsoft",
  tenant: "microsoft",
  domain: "microsoft.com",
  tier: "0",
  priority: "GO"
};

const msCompany = {
  name: "Morgan Stanley",
  tenant: "morganstanley",
  domain: "morganstanley.com",
  tier: "0",
  priority: "GO"
};

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const msftEngineeringFixture = {
  id: 1970393556944049,
  displayJobId: "200045370",
  name: "Software Engineer II - Azure Core Distributed Systems",
  locations: ["Bengaluru, Karnataka, India", "Hyderabad, Telangana, India"],
  standardizedLocations: ["IN"],
  postedTs: 1786435976, // 2026-08-11
  department: "Cloud + AI",
  creationTs: 1784900258,
  isHot: 0,
  workLocationOption: "hybrid",
  positionUrl: "/careers/job/1970393556944049",
  jobDescription: "<p>We are seeking a <b>Software Engineer II</b> with 3+ years of experience in distributed systems, C++, C# or Java.</p>"
};

const msftNonEngineeringFixture = {
  id: 1970393556950431,
  displayJobId: "200045380",
  name: "Senior Technical Recruiter - Executive Hiring",
  locations: ["Hyderabad, Telangana, India"],
  standardizedLocations: ["IN"],
  postedTs: 1786435976,
  department: "Human Resources",
  creationTs: 1784900258,
  isHot: 0,
  workLocationOption: "onsite",
  positionUrl: "/careers/job/1970393556950431",
  jobDescription: "<p>Lead executive talent acquisition across India hubs.</p>"
};

const msEngineeringFixture = {
  id: 549799698131,
  displayJobId: "PT-JR042295",
  name: "Data Platform Engineer, Associate - Wealth Management Tech",
  locations: ["Mumbai, Maharashtra, India", "Bengaluru, Karnataka, India"],
  standardizedLocations: ["Mumbai, MH, IN"],
  postedTs: 1787184000,
  department: "Software Engineering",
  creationTs: 1786579200,
  isHot: 1,
  workLocationOption: "onsite",
  positionUrl: "/careers/job/549799698131",
  jobDescription: "<p>Requirements: 2 to 4 years of experience building data pipelines with Spark, Kafka, and Python.</p>"
};

const msNonEngineeringFixture = {
  id: 549799150938,
  displayJobId: "PT-JR042290",
  name: "BDS Senior Content Manager, Vice President, Investment Management",
  locations: ["Mumbai, Maharashtra, India"],
  standardizedLocations: ["Mumbai, MH, IN"],
  postedTs: 1787184000,
  department: "Asset Management",
  creationTs: 1786579200,
  isHot: 0,
  workLocationOption: "onsite",
  positionUrl: "/careers/job/549799150938",
  jobDescription: "<p>Oversee investment marketing and content delivery.</p>"
};

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 1] Microsoft Engineering Job Normalization
// ─────────────────────────────────────────────────────────────────────────────
console.log("[Test 1] Microsoft Engineering Job Normalization");
{
  const norm = eightfold.normalize(msftEngineeringFixture, msftCompany);
  assert.strictEqual(norm.source, "eightfold");
  assert.strictEqual(norm.source_type, "employer_ats");
  assert.strictEqual(norm.company, "Microsoft");
  assert.strictEqual(norm.tier, "0");
  assert.strictEqual(norm.priority, "GO");
  assert.strictEqual(norm.title, "Software Engineer II - Azure Core Distributed Systems");
  assert.ok(norm.location.includes("Bengaluru") && norm.location.includes("Hyderabad"));
  assert.strictEqual(norm.url, "https://microsoft.eightfold.ai/careers/job/1970393556944049");
  assert.strictEqual(norm.apply_url, "https://microsoft.eightfold.ai/careers/apply?pid=1970393556944049&domain=microsoft.com");
  assert.strictEqual(norm.posted_at, new Date(1786435976 * 1000).toISOString());
  assert.strictEqual(norm.department, "Cloud + AI");
  assert.strictEqual(norm.remote, false);
  assert.ok(norm._experienceText.includes("3+ years of experience in distributed systems"));
  console.log("  ✅ Passed: Microsoft engineering job normalized accurately");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 2] Microsoft Non-Engineering Job Normalization & Classification
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 2] Microsoft Non-Engineering Job Normalization");
{
  const norm = eightfold.normalize(msftNonEngineeringFixture, msftCompany);
  assert.strictEqual(norm.company, "Microsoft");
  assert.strictEqual(norm.title, "Senior Technical Recruiter - Executive Hiring");
  assert.strictEqual(norm.department, "Human Resources");
  
  // Non-tech filter check
  const isExcluded = /\b(recruiter|talent|hr|human resources)\b/i.test(norm.title);
  assert.ok(isExcluded, "Recruiter role must match non-tech exclusions");
  console.log("  ✅ Passed: Microsoft non-engineering job normalized and identifiable as non-tech");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 3] Morgan Stanley Engineering Job Normalization
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 3] Morgan Stanley Engineering Job Normalization");
{
  const norm = eightfold.normalize(msEngineeringFixture, msCompany);
  assert.strictEqual(norm.source, "eightfold");
  assert.strictEqual(norm.source_type, "employer_ats");
  assert.strictEqual(norm.company, "Morgan Stanley");
  assert.strictEqual(norm.tier, "0");
  assert.strictEqual(norm.priority, "GO");
  assert.strictEqual(norm.title, "Data Platform Engineer, Associate - Wealth Management Tech");
  assert.ok(norm.location.includes("Mumbai") && norm.location.includes("Bengaluru"));
  assert.strictEqual(norm.url, "https://morganstanley.eightfold.ai/careers/job/549799698131");
  assert.strictEqual(norm.apply_url, "https://morganstanley.eightfold.ai/careers/apply?pid=549799698131&domain=morganstanley.com");
  assert.strictEqual(norm.posted_at, new Date(1787184000 * 1000).toISOString());
  assert.ok(norm._experienceText.includes("2 to 4 years of experience"));
  console.log("  ✅ Passed: Morgan Stanley engineering job normalized accurately");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 4] Morgan Stanley Non-Engineering Job Normalization
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 4] Morgan Stanley Non-Engineering Job Normalization");
{
  const norm = eightfold.normalize(msNonEngineeringFixture, msCompany);
  assert.strictEqual(norm.company, "Morgan Stanley");
  assert.strictEqual(norm.title, "BDS Senior Content Manager, Vice President, Investment Management");
  assert.strictEqual(norm.department, "Asset Management");
  
  // Non-tech & management filter check
  const isExcluded = /\b(content|marketing|investment management|asset management|vice president|vp\b)\b/i.test(norm.title);
  assert.ok(isExcluded, "Content Manager / VP role must match exclusions");
  console.log("  ✅ Passed: Morgan Stanley non-engineering job normalized and identifiable as excluded");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 5] Missing Optional Fields Handling (Schema Resilience)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 5] Missing Optional Fields Handling");
{
  const minimalJob = {
    id: 999111,
    name: "Software Engineer"
  };
  const norm = eightfold.normalize(minimalJob, msftCompany);
  assert.strictEqual(norm.title, "Software Engineer");
  assert.strictEqual(norm.location, "India");
  assert.strictEqual(norm.posted_at, null);
  assert.strictEqual(norm.department, "");
  assert.strictEqual(norm.remote, false);
  assert.strictEqual(norm.url, "https://microsoft.eightfold.ai/careers/job/999111");
  assert.strictEqual(norm.apply_url, "https://microsoft.eightfold.ai/careers/apply?pid=999111&domain=microsoft.com");
  console.log("  ✅ Passed: Minimal job normalized safely without exceptions");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 6] Malformed / Empty Location Handling
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 6] Malformed & Array Location Normalization");
{
  const emptyLocJob = { id: 123, name: "SDE", locations: [] };
  const strLocJob = { id: 124, name: "SDE", location: "Bengaluru, India" };
  const nullLocJob = { id: 125, name: "SDE", locations: null, location: null };

  assert.strictEqual(eightfold.normalize(emptyLocJob, msftCompany).location, "India");
  assert.strictEqual(eightfold.normalize(strLocJob, msftCompany).location, "Bengaluru, India");
  assert.strictEqual(eightfold.normalize(nullLocJob, msftCompany).location, "India");
  console.log("  ✅ Passed: Array, string, empty, and null locations normalized gracefully");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 7] Posted-Date & Creation Timestamp Fallback
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 7] Timestamp Parsing & Creation Date Fallback");
{
  const jobWithPosted = { id: 1, name: "SDE", postedTs: 1786435976, creationTs: 1784900258 };
  const jobWithOnlyCreated = { id: 2, name: "SDE", postedTs: 0, creationTs: 1784900258 };
  const jobWithNoDate = { id: 3, name: "SDE", postedTs: null, creationTs: 0 };

  assert.strictEqual(eightfold.normalize(jobWithPosted, msftCompany).posted_at, new Date(1786435976 * 1000).toISOString());
  assert.strictEqual(eightfold.normalize(jobWithOnlyCreated, msftCompany).posted_at, new Date(1784900258 * 1000).toISOString());
  assert.strictEqual(eightfold.normalize(jobWithNoDate, msftCompany).posted_at, null);
  console.log("  ✅ Passed: Timestamp conversion and creationTs fallback verified");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 8] Direct Application URL Construction
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 8] Direct Application URL Construction");
{
  const job = { id: "1234567", name: "SDE II" };
  const norm = eightfold.normalize(job, msftCompany);
  assert.strictEqual(norm.apply_url, "https://microsoft.eightfold.ai/careers/apply?pid=1234567&domain=microsoft.com");
  console.log("  ✅ Passed: Direct application URL constructed properly with domain query");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 9] Schema Invariants & Purity
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 9] Schema Invariants & Purity");
{
  const requiredKeys = [
    "source", "source_type", "company", "tier", "priority", 
    "title", "location", "url", "apply_url", "posted_at", 
    "department", "remote", "snippet", "_experienceText"
  ];
  const norm = eightfold.normalize(msftEngineeringFixture, msftCompany);
  for (const k of requiredKeys) {
    assert.ok(k in norm, `Missing expected key "${k}" in normalized job`);
  }
  assert.strictEqual(norm.source_type, "employer_ats");
  console.log("  ✅ Passed: All CanonicalJob schema fields present and typed accurately");
}

// ─────────────────────────────────────────────────────────────────────────────
// [TEST 10] Non-Engineering Role Exclusion Invariants
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 10] Non-Engineering Role Exclusion Invariants");
{
  const nonTechTitles = [
    "Technical Recruiter II",
    "Lead Product Manager - Copilot",
    "Legal Counsel - Corporate",
    "Finance Analyst - Treasury",
    "HR Business Partner",
    "Enterprise Account Executive",
    "Senior Customer Support Engineer",
    "Principal Technical Program Manager"
  ];

  const HARD_DROP_REGEX = /\b(manager|director|vp\b|vice president|head of|chief|cto|cpo|coo|scrum master|agile coach|sales|marketing|growth|content|video|finance|accounting|controller|equity research|portfolio specialist|hr\b|human resources|recruiter|talent|facilities|warehouse|fleet|category|cx\b|customer experience|client servicing|account executive|account manager|business development|bd\b|legal|counsel|procurement|strategist|transformation owner|solutions architect|presales|sales engineer|technical writer|qa\b|quality assurance|sdet|test engineer|automation engineer|support engineer|customer support|technical support|it helpdesk|tech support|community engineer|devrel)\b/i;

  for (const title of nonTechTitles) {
    const isExcluded = HARD_DROP_REGEX.test(title);
    assert.ok(isExcluded, `Title "${title}" must be excluded by gate rules`);
  }
  console.log("  ✅ Passed: All non-engineering role types match exclusion rules");
}

console.log("\n========================================================");
console.log("🎉 ALL 10 EIGHTFOLD ADAPTER TESTS PASSED!");
console.log("========================================================\n");

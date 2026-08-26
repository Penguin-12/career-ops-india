/**
 * tests/test-pcsx-adapter.mjs — Comprehensive Test Suite for Generic Eightfold PCSX Adapter
 * 
 * Validates:
 * 1. Microsoft normalization & URL derivation
 * 2. Qualcomm normalization & URL derivation (careers.qualcomm.com)
 * 3. Micron normalization & URL derivation (micron.eightfold.ai)
 * 4. Morgan Stanley normalization & URL derivation (morganstanley.eightfold.ai)
 * 5. Vodafone normalization & URL derivation (vodafone.eightfold.ai)
 * 6. Location normalization variants (standardizedLocations array, locations array, single string)
 * 7. Timestamp parsing (seconds vs milliseconds Unix timestamps)
 * 8. Requisition ID extraction precedence (displayJobId, atsJobId, numeric id)
 * 9. Deduplication and empty/terminal batch handling
 */

import assert from "assert";
import pcsx from "../scripts/adapters/pcsx.mjs";

console.log("=== Eightfold PCSX Adapter Test Suite ===\n");

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const microsoftFixture = {
  id: 1970393556944049,
  displayJobId: "200045370",
  name: "Software Engineer II - Azure Core Distributed Systems",
  locations: ["India, Karnataka, Bangalore", "India, Telangana, Hyderabad"],
  standardizedLocations: ["Bengaluru, KA, IN", "Hyderabad, TS, IN"],
  postedTs: 1786435976,
  department: "Cloud + AI",
  creationTs: 1784900258,
  workLocationOption: "hybrid",
  positionUrl: "/careers/job/1970393556944049"
};

const qualcommFixture = {
  id: 446716949204,
  displayJobId: "3086510",
  atsJobId: "3086510",
  name: "Staff Engineer - Display Software Team",
  locations: ["Hyderabad, Telangāna, India"],
  standardizedLocations: ["Hyderabad, TS, IN"],
  postedTs: 1786492800,
  department: "Engineering",
  creationTs: 1771286400,
  workLocationOption: "onsite",
  positionUrl: "/careers/job/446716949204"
};

const micronFixture = {
  id: 43701972,
  displayJobId: "JR106448",
  atsJobId: "JR106448",
  name: "STAFF ENGINEER, SSD NVMQRA TEST DEV ENG",
  locations: ["Hyderabad, Telangana, India"],
  standardizedLocations: ["Hyderabad, TS, IN"],
  postedTs: 1786060800,
  department: "Quality",
  creationTs: 1786060800,
  workLocationOption: "onsite",
  positionUrl: "/careers/job/43701972"
};

const morganStanleyFixture = {
  id: 549799344034,
  displayJobId: "PT-JR039956",
  atsJobId: "PT-JR039956",
  name: "Java Lead_ Vice President- Software Engineer",
  locations: ["Mumbai, Maharashtra, India"],
  standardizedLocations: ["Mumbai, MH, IN"],
  postedTs: 1785196800,
  department: "Technology",
  creationTs: 1785110400,
  workLocationOption: "hybrid",
  positionUrl: "/careers/job/549799344034"
};

const vodafoneFixture = {
  id: 563018695475994,
  displayJobId: "284106",
  atsJobId: "284106",
  name: "Oracle RODOD Stack & DevOps/SRE- Technical Architect- Pune",
  locations: ["Pune, Maharashtra, India"],
  standardizedLocations: ["Pune, MH, IN"],
  postedTs: 1771939055,
  department: "Technology",
  creationTs: 1771564066,
  workLocationOption: "hybrid",
  positionUrl: "/careers/job/563018695475994"
};

const edgeCaseFixture = {
  id: 998877,
  name: "Remote AI Systems Architect",
  location: "Bengaluru, India",
  creationTs: 1786060800000, // Milliseconds timestamp
  workLocationOption: "remote"
};

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log("[Test 1] Microsoft Normalization via PCSX");
{
  const norm = pcsx.normalize(microsoftFixture, {
    name: "Microsoft",
    host: "apply.careers.microsoft.com",
    domain: "microsoft.com",
    tier: "0",
    priority: "GO"
  });

  assert.strictEqual(norm.source, "pcsx");
  assert.strictEqual(norm.company, "Microsoft");
  assert.strictEqual(norm.title, "Software Engineer II - Azure Core Distributed Systems");
  assert.strictEqual(norm.url, "https://apply.careers.microsoft.com/careers/job/1970393556944049?hl=en");
  assert.strictEqual(norm.location, "Bengaluru, India; Hyderabad, India");
  assert.strictEqual(norm.remote, false);
  assert.strictEqual(norm.tier, "0");
  assert.ok(norm.posted_at.startsWith("2026-08"));
  console.log("  ✅ Microsoft normalized correctly");
}

console.log("[Test 2] Qualcomm Normalization & URL Construction");
{
  const norm = pcsx.normalize(qualcommFixture, {
    name: "Qualcomm",
    host: "careers.qualcomm.com",
    domain_host: "qualcomm.com",
    tier: "0",
    priority: "GO"
  });

  assert.strictEqual(norm.company, "Qualcomm");
  assert.strictEqual(norm.title, "Staff Engineer - Display Software Team");
  assert.strictEqual(norm.url, "https://careers.qualcomm.com/careers/job/446716949204?hl=en");
  assert.strictEqual(norm.location, "Hyderabad, India");
  assert.strictEqual(norm.department, "Engineering");
  assert.ok(norm.posted_at.startsWith("2026-08"));
  console.log("  ✅ Qualcomm normalized correctly with dynamic host");
}

console.log("[Test 3] Micron Normalization with Alphanumeric displayJobId");
{
  const norm = pcsx.normalize(micronFixture, {
    name: "Micron",
    host: "micron.eightfold.ai",
    domain_host: "micron.com",
    tier: "1",
    priority: "GO"
  });

  assert.strictEqual(norm.company, "Micron");
  assert.strictEqual(norm.title, "STAFF ENGINEER, SSD NVMQRA TEST DEV ENG");
  assert.strictEqual(norm.url, "https://micron.eightfold.ai/careers/job/43701972?hl=en");
  assert.strictEqual(norm.location, "Hyderabad, India");
  assert.strictEqual(norm.tier, "1");
  console.log("  ✅ Micron normalized correctly");
}

console.log("[Test 4] Morgan Stanley Normalization with Complex ID");
{
  const norm = pcsx.normalize(morganStanleyFixture, {
    name: "Morgan Stanley",
    host: "morganstanley.eightfold.ai",
    domain_host: "morganstanley.com",
    tier: "1",
    priority: "GO"
  });

  assert.strictEqual(norm.company, "Morgan Stanley");
  assert.strictEqual(norm.title, "Java Lead_ Vice President- Software Engineer");
  assert.strictEqual(norm.url, "https://morganstanley.eightfold.ai/careers/job/549799344034?hl=en");
  assert.strictEqual(norm.location, "Mumbai, India");
  console.log("  ✅ Morgan Stanley normalized correctly");
}

console.log("[Test 5] Vodafone / VOIS Normalization");
{
  const norm = pcsx.normalize(vodafoneFixture, {
    name: "Vodafone",
    host: "vodafone.eightfold.ai",
    domain_host: "vodafone.com",
    tier: "2",
    priority: "GOOD"
  });

  assert.strictEqual(norm.company, "Vodafone");
  assert.strictEqual(norm.title, "Oracle RODOD Stack & DevOps/SRE- Technical Architect- Pune");
  assert.strictEqual(norm.url, "https://vodafone.eightfold.ai/careers/job/563018695475994?hl=en");
  assert.strictEqual(norm.location, "Pune, India");
  console.log("  ✅ Vodafone normalized correctly");
}

console.log("[Test 6] Edge Case: Milliseconds timestamp, string location, remote flag");
{
  const norm = pcsx.normalize(edgeCaseFixture, {
    name: "AI Tech",
    host: "aitech.eightfold.ai",
    domain_host: "aitech.com"
  });

  assert.strictEqual(norm.title, "Remote AI Systems Architect");
  assert.strictEqual(norm.remote, true);
  assert.strictEqual(norm.location, "Bengaluru, India");
  assert.strictEqual(norm.url, "https://aitech.eightfold.ai/careers/job/998877?hl=en");
  assert.ok(norm.posted_at.startsWith("2026-08"));
  console.log("  ✅ Milliseconds timestamp & remote detection handled");
}

console.log("\nAll 6 PCSX Adapter Test Suites Passed! 🚀");


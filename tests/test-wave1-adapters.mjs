/**
 * tests/test-wave1-adapters.mjs — Test suite for Wave 1 Adapters
 * 
 * Validates:
 * 1. Oracle Cloud HCM (JPMorgan Chase & Goldman Sachs)
 * 2. Google Careers SSR (AF_initDataCallback ds:1)
 * 3. D.E. Shaw India Careers (__NEXT_DATA__ regularJobs)
 * 4. Error isolation, schema purity, and source_type semantics
 */

import assert from "assert";
import oraclecloud from "../scripts/adapters/oraclecloud.mjs";
import google from "../scripts/adapters/google.mjs";
import deshaw from "../scripts/adapters/deshaw.mjs";

console.log("=== Wave 1 Adapters Test Suite ===\n");

// [Test 1] Oracle Cloud HCM - JPMorgan Chase normalization
console.log("[Test 1] Oracle Cloud HCM: JPMorgan Chase fixture normalization");
{
  const rawJPMC = {
    Id: "210678980",
    Title: "Software Engineer III - Cloud & Platform",
    PrimaryLocation: "Bengaluru, Karnataka, India",
    PostedDate: "2026-08-20",
    JobFamily: "Software Engineering",
    JobFunction: "Platform Infrastructure",
    ExternalQualificationsStr: "<p>3+ years Java/Python and Kubernetes experience.</p>",
    ExternalResponsibilitiesStr: "<p>Design and build scalable platform services.</p>",
    ShortDescriptionStr: "<p>Join JPMorgan Chase Cloud Platform team.</p>",
    WorkplaceType: "Hybrid"
  };

  const company = {
    name: "JPMorgan Chase",
    host: "jpmc.fa.oraclecloud.com",
    site: "CX_1001",
    tier: "0",
    priority: "GO"
  };

  const job = oraclecloud.normalize(rawJPMC, company);
  assert.strictEqual(job.source, "oraclecloud");
  assert.strictEqual(job.source_type, "employer_ats");
  assert.strictEqual(job.company, "JPMorgan Chase");
  assert.strictEqual(job.tier, "0");
  assert.strictEqual(job.priority, "GO");
  assert.strictEqual(job.title, "Software Engineer III - Cloud & Platform");
  assert.strictEqual(job.location, "Bengaluru, Karnataka, India");
  assert.strictEqual(job.url, "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions/preview/210678980");
  assert.strictEqual(job.posted_at, "2026-08-20T00:00:00.000Z");
  assert.strictEqual(job.department, "Software Engineering");
  assert.ok(job._experienceText.includes("Kubernetes"));
  console.log("  ✅ Passed: JPMorgan Chase Oracle Cloud HCM fixture normalized correctly");
}

// [Test 2] Oracle Cloud HCM - Goldman Sachs normalization
console.log("\n[Test 2] Oracle Cloud HCM: Goldman Sachs fixture normalization");
{
  const rawGS = {
    Id: "134845",
    Title: "Software Engineer, Quantitative Execution Services, Associate",
    PrimaryLocation: "Hyderabad, Telangana, India",
    PostedDate: "2026-08-21",
    JobFamily: "Engineering",
    JobFunction: "Quant Technology",
    ExternalQualificationsStr: "<p>C++, Distributed Systems, 2-5 YOE.</p>",
    ExternalResponsibilitiesStr: "<p>Build high-frequency execution infrastructure.</p>",
    ShortDescriptionStr: "<p>Join Goldman Sachs Engineering in Hyderabad.</p>"
  };

  const company = {
    name: "Goldman Sachs",
    host: "hdpc.fa.us2.oraclecloud.com",
    site: "LateralHiring",
    tier: "0",
    priority: "GO"
  };

  const job = oraclecloud.normalize(rawGS, company);
  assert.strictEqual(job.source, "oraclecloud");
  assert.strictEqual(job.source_type, "employer_ats");
  assert.strictEqual(job.company, "Goldman Sachs");
  assert.strictEqual(job.tier, "0");
  assert.strictEqual(job.priority, "GO");
  assert.strictEqual(job.title, "Software Engineer, Quantitative Execution Services, Associate");
  assert.strictEqual(job.location, "Hyderabad, Telangana, India");
  assert.strictEqual(job.url, "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/requisitions/preview/134845");
  assert.ok(job._experienceText.includes("Distributed Systems"));
  console.log("  ✅ Passed: Goldman Sachs Oracle Cloud HCM fixture normalized correctly");
}

// [Test 3] Oracle Cloud HCM - Missing host and error resilience
console.log("\n[Test 3] Oracle Cloud HCM: Error isolation & validation");
{
  const res = await oraclecloud.fetchJobs({ name: "Bad Host Company" });
  assert.strictEqual(res.jobs.length, 0);
  assert.ok(res.err.includes("Missing host"));
  console.log("  ✅ Passed: Oracle Cloud HCM isolates missing host configuration without crashing");
}

// [Test 4] Google Careers SSR - ds:1 payload normalization
console.log("\n[Test 4] Google Careers: AF_initDataCallback (ds:1) fixture normalization");
{
  const rawGoogle = [
    "75579174143566534", // 0: ID
    "Senior Software Engineer, Fabric Networking", // 1: Title
    "https://www.google.com/about/careers/applications/signin?jobId=123", // 2: URL
    [null, "<ul><li>Write distributed systems code</li></ul>"], // 3: Resp
    [null, "<h3>Minimum qualifications:</h3><ul><li>Bachelor degree</li><li>3 years experience</li></ul>"], // 4: Qual
    "projects/gweb-careers-proto/tenants/123", // 5
    null, // 6
    "Google", // 7
    "en-US", // 8
    [["Bengaluru, Karnataka, India", ["Address"], "Bengaluru", "560038", "KA", "IN"]], // 9: Location
    [null, "<p>Google software engineers develop next-gen technologies.</p>"], // 10: Desc
    [2,3,4], // 11
    [1778178571, 956000000] // 12: Timestamp
  ];

  const company = { name: "Google", tier: "0", priority: "GO" };
  const job = google.normalize(rawGoogle, company);

  assert.strictEqual(job.source, "google");
  assert.strictEqual(job.source_type, "employer_careers");
  assert.strictEqual(job.company, "Google");
  assert.strictEqual(job.tier, "0");
  assert.strictEqual(job.priority, "GO");
  assert.strictEqual(job.title, "Senior Software Engineer, Fabric Networking");
  assert.strictEqual(job.location, "Bengaluru, Karnataka, India");
  assert.strictEqual(job.url, "https://www.google.com/about/careers/applications/signin?jobId=123");
  assert.strictEqual(job.posted_at, new Date(1778178571 * 1000).toISOString());
  assert.ok(job._experienceText.includes("distributed systems"));
  console.log("  ✅ Passed: Google Careers structured payload normalized accurately");
}

// [Test 5] D.E. Shaw Next.js - regularJobs normalization
console.log("\n[Test 5] D.E. Shaw: Next.js __NEXT_DATA__ regularJobs normalization");
{
  const rawDEShaw = {
    id: 6989,
    displayName: "Lead, Tech (Legal & Comply Tech)",
    header: ["TECH"],
    category: ["Information Technology"],
    office: [
      { name: "Hyderabad", abbreviation: "HYD" },
      { name: "Bengaluru", abbreviation: "BLR" }
    ],
    data: {
      id: 6989,
      displayName: "Lead, Tech (Legal & Comply Tech)",
      jobUrl: "Lead-Tech-Legal-Comply-Tech-6989",
      department: { name: "Comply Tech" },
      jobDescription: {
        websiteDescription: "<p>We are looking for experienced engineers...</p>",
        responsibilitiesHtml: "<ul><li>Lead distributed platform design</li></ul>",
        peopleWeAreLookingForHtml: "<ul><li>Strong C++ / Java / Python foundation</li></ul>"
      }
    }
  };

  const company = { name: "D.E. Shaw", tier: "0", priority: "GO" };
  const job = deshaw.normalize(rawDEShaw, company);

  assert.strictEqual(job.source, "deshaw");
  assert.strictEqual(job.source_type, "employer_careers");
  assert.strictEqual(job.company, "D.E. Shaw");
  assert.strictEqual(job.tier, "0");
  assert.strictEqual(job.priority, "GO");
  assert.strictEqual(job.title, "Lead, Tech (Legal & Comply Tech)");
  assert.strictEqual(job.location, "Hyderabad, Bengaluru, India");
  assert.strictEqual(job.url, "https://www.deshawindia.com/careers/Lead-Tech-Legal-Comply-Tech-6989");
  assert.strictEqual(job.posted_at, null);
  assert.strictEqual(job.department, "TECH");
  assert.ok(job._experienceText.includes("distributed platform design"));
  console.log("  ✅ Passed: D.E. Shaw Next.js regularJobs fixture normalized accurately");
}

// [Test 6] Schema Purity & Source Type Invariance
console.log("\n[Test 6] Schema Purity & Source Type Invariance");
{
  const oracleJob = oraclecloud.normalize({ Title: "Oracle Test" }, { host: "test.com" });
  assert.strictEqual(oracleJob.source_type, "employer_ats");

  const googleJob = google.normalize(["1", "Google Test"], { name: "Google" });
  assert.strictEqual(googleJob.source_type, "employer_careers");

  const deshawJob = deshaw.normalize({ displayName: "DE Shaw Test" }, { name: "D.E. Shaw" });
  assert.strictEqual(deshawJob.source_type, "employer_careers");

  console.log("  ✅ Passed: All Wave 1 adapters enforce strict source_type semantics");
}

console.log("\n========================================================");
console.log("🎉 ALL 6 WAVE 1 ADAPTER TESTS PASSED!");
console.log("========================================================\n");


#!/usr/bin/env node
/**
 * tests/test-discovery-ingest.mjs — Discovery Ingestion & Precedence Test Suite
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ingestDiscovery,
  validateDiscoveryRecord,
  resolveCompany,
  buildCompanyLookup,
  computeDedupKey,
  normaliseJobTitle,
  readConfig,
  readPortals
} from "../scripts/ingest-discovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

console.log("=== Discovery Ingestion & Precedence Test Suite ===\n");

// [Test 1] Python scraper output points to discovery_results.json
console.log("[Test 1] Scraper destination verification");
{
  const naukriScript = fs.readFileSync(path.join(ROOT, "scrapers/naukri_stealth.py"), "utf8");
  const smartScript = fs.readFileSync(path.join(ROOT, "scrapers/smart_job_scraper.py"), "utf8");

  assert.ok(naukriScript.includes("discovery_results.json"), "naukri_stealth writes to discovery_results.json");
  assert.ok(!naukriScript.includes('data" / "scan_results.json"'), "naukri_stealth does NOT write to scan_results.json");
  assert.ok(smartScript.includes("discovery_results.json"), "smart_job_scraper writes to discovery_results.json");
  assert.ok(!smartScript.includes('data" / "scan_results.json"'), "smart_job_scraper does NOT write to scan_results.json");
  console.log("  ✅ Passed: Python scrapers point to data/discovery_results.json");
}

// [Test 2] Python scrapers use atomic file write
console.log("\n[Test 2] Python scrapers write atomically with .tmp replace");
{
  const naukriScript = fs.readFileSync(path.join(ROOT, "scrapers/naukri_stealth.py"), "utf8");
  const smartScript = fs.readFileSync(path.join(ROOT, "scrapers/smart_job_scraper.py"), "utf8");

  assert.ok(naukriScript.includes(".with_suffix(\".tmp\")") || naukriScript.includes(".tmp"), "Naukri uses temp file");
  assert.ok(naukriScript.includes("os.replace") || naukriScript.includes("rename"), "Naukri uses atomic replace");
  assert.ok(smartScript.includes(".with_suffix(\".tmp\")") || smartScript.includes(".tmp"), "Smart scraper uses temp file");
  assert.ok(smartScript.includes("os.replace") || smartScript.includes("rename"), "Smart scraper uses atomic replace");
  console.log("  ✅ Passed: Scrapers use atomic write/replace semantics");
}

// [Test 3] Validation rejects invalid discovery records
console.log("\n[Test 3] Discovery record validation");
{
  assert.strictEqual(validateDiscoveryRecord(null).valid, false);
  assert.strictEqual(validateDiscoveryRecord({}).valid, false);
  assert.strictEqual(validateDiscoveryRecord({ title: "SDE" }).valid, false);
  assert.strictEqual(validateDiscoveryRecord({ title: "SDE", company: "Amazon" }).valid, false); // missing url
  assert.strictEqual(validateDiscoveryRecord({ title: "SDE", company: "Amazon", url: "ftp://bad" }).valid, false);
  assert.strictEqual(validateDiscoveryRecord({ title: "SDE II", company: "Amazon", url: "https://amazon.jobs/123" }).valid, true);
  console.log("  ✅ Passed: Invalid discovery records correctly rejected");
}

// [Test 4] Company resolution against portals/india.yml
console.log("\n[Test 4] Company resolution & canonical metadata attachment");
{
  const portals = readPortals();
  const lookup = buildCompanyLookup(portals);

  const res1 = resolveCompany("Amazon Development Centre India", lookup);
  assert.strictEqual(res1.name, "Amazon");
  assert.strictEqual(res1.tier, "1");
  assert.strictEqual(res1.priority, "GO");

  const res2 = resolveCompany("Razorpay Software", lookup);
  assert.strictEqual(res2.name, "Razorpay");
  assert.strictEqual(res2.tier, "1");

  const res3 = resolveCompany("Unregistered Stealth AI Startup", lookup);
  assert.strictEqual(res3.name, "Unregistered Stealth AI Startup");
  assert.strictEqual(res3.tier, "2");
  assert.strictEqual(res3.priority, "GOOD");
  console.log("  ✅ Passed: Company resolution correctly maps canonical names, tiers, and priorities");
}

// [Test 5] Deduplication key normalization
console.log("\n[Test 5] Title normalization & dedup key generation");
{
  const k1 = computeDedupKey("Amazon", "Software Development Engineer II");
  const k2 = computeDedupKey("Amazon", "Software Dev Engineer II");
  const k3 = computeDedupKey("Amazon", "SDE II");
  const k4 = computeDedupKey("Amazon", "SDE 2");

  assert.strictEqual(k1, k2, "SDE II matches Software Dev Engineer II");
  assert.strictEqual(k1, k3, "SDE II matches SDE II");
  assert.strictEqual(k1, k4, "SDE II matches SDE 2");
  console.log("  ✅ Passed: Title equivalences normalized correctly for deduplication");
}

// [Test 6] End-to-end Ingestion with ATS Precedence & Deduplication
console.log("\n[Test 6] Official ATS Precedence: ATS record beats Naukri aggregator duplicate");
{
  const tempDir = path.join(ROOT, "data/test_fixtures");
  fs.mkdirSync(tempDir, { recursive: true });
  const testScanPath = path.join(tempDir, "test_scan_results.json");
  const testDiscPath = path.join(tempDir, "test_discovery_results.json");

  // Initial baseline scan with official ATS job
  const baselineScan = {
    scanned_at: new Date().toISOString(),
    total: 1,
    jobs: [
      {
        source: "amazon",
        source_type: "employer_ats",
        company: "Amazon",
        tier: "1",
        priority: "GO",
        title: "Software Development Engineer II, Payments",
        location: "Bengaluru, India",
        url: "https://amazon.jobs/10507894",
        score: 95,
        role_family: "general_sde",
        job_seniority: "sde_2",
        experience_fit: "primary"
      }
    ]
  };
  fs.writeFileSync(testScanPath, JSON.stringify(baselineScan, null, 2), "utf8");

  // Discovery batch containing:
  // 1. Exact duplicate of Amazon Payments (from Naukri) -> MUST BE DROPPED
  // 2. New valid discovery job from Naukri (PhonePe Backend) -> MUST BE ACCEPTED
  // 3. Duplicate within discovery batch (PhonePe Backend duplicate) -> MUST BE COLLAPSED
  // 4. Invalid job (missing title) -> MUST BE REJECTED
  // 5. Non-tech job (Sales Manager) -> MUST BE FILTERED BY GATES
  const discoveryBatch = {
    discovered_at: new Date().toISOString(),
    jobs: [
      {
        source: "naukri",
        source_type: "aggregator",
        company: "Amazon",
        title: "SDE II, Payments",
        location: "Bangalore",
        url: "https://www.naukri.com/job-listings-amazon-sde-2-payments",
        posted_at: new Date().toISOString()
      },
      {
        source: "naukri",
        source_type: "aggregator",
        company: "PhonePe",
        title: "Backend Engineer II - Core Systems",
        location: "Bangalore",
        url: "https://www.naukri.com/job-listings-phonepe-backend-2",
        apply_url: "https://phonepe.com/careers/backend-2",
        snippet: "Core distributed systems in Java, Kafka, MySQL. 3+ years experience.",
        posted_at: new Date().toISOString(),
        salary: "35-45 LPA",
        experience: "2-4 Yrs"
      },
      {
        source: "naukri",
        source_type: "aggregator",
        company: "PhonePe",
        title: "Backend Engineer II - Core Systems", // exact duplicate in same batch
        location: "Bangalore",
        url: "https://www.naukri.com/job-listings-phonepe-backend-2-duplicate",
        posted_at: new Date().toISOString()
      },
      {
        source: "naukri",
        source_type: "aggregator",
        company: "Bad Company",
        title: "", // invalid
        url: "https://naukri.com/bad"
      },
      {
        source: "naukri",
        source_type: "aggregator",
        company: "Swiggy",
        title: "Regional Sales Manager", // non-technical hard drop
        location: "Bangalore",
        url: "https://naukri.com/sales"
      }
    ]
  };
  fs.writeFileSync(testDiscPath, JSON.stringify(discoveryBatch, null, 2), "utf8");

  const res = ingestDiscovery({
    discoveryPath: testDiscPath,
    scanResultsPath: testScanPath,
    silent: true
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.totalEvaluated, 5);
  assert.strictEqual(res.rejectedCount, 1, "1 invalid title rejected");
  assert.strictEqual(res.atsDuplicatesDropped, 1, "1 ATS duplicate dropped (Amazon SDE II Payments)");
  assert.strictEqual(res.discoveryCollapsed, 1, "1 duplicate within discovery batch collapsed");
  assert.strictEqual(res.gateFilteredCount, 1, "1 non-tech Sales Manager filtered");
  assert.strictEqual(res.acceptedCount, 1, "1 PhonePe Backend Engineer accepted");
  assert.strictEqual(res.finalCount, 2, "1 existing ATS job + 1 new discovery job");

  // Read updated scan results
  const updatedScan = JSON.parse(fs.readFileSync(testScanPath, "utf8"));
  assert.strictEqual(updatedScan.jobs.length, 2);

  // Check that Amazon job preserved its official ATS properties
  const amazonJob = updatedScan.jobs.find(j => j.company === "Amazon");
  assert.strictEqual(amazonJob.source, "amazon");
  assert.strictEqual(amazonJob.source_type, "employer_ats");
  assert.strictEqual(amazonJob.url, "https://amazon.jobs/10507894");

  // Check that PhonePe discovery job received taxonomy, score, and preserved apply_url
  const phonepeJob = updatedScan.jobs.find(j => j.company === "PhonePe");
  assert.strictEqual(phonepeJob.source, "naukri");
  assert.strictEqual(phonepeJob.source_type, "aggregator");
  assert.strictEqual(phonepeJob.role_family, "backend");
  assert.strictEqual(phonepeJob.job_seniority, "sde_2");
  assert.strictEqual(phonepeJob.experience_fit, "primary");
  assert.strictEqual(phonepeJob.apply_url, "https://phonepe.com/careers/backend-2");
  assert.strictEqual(phonepeJob.salary, "35-45 LPA");
  assert.strictEqual(typeof phonepeJob.score, "number");
  assert.ok(phonepeJob.score >= 80, `PhonePe score is ${phonepeJob.score}`);

  // Cleanup test files
  fs.unlinkSync(testScanPath);
  fs.unlinkSync(testDiscPath);
  fs.rmdirSync(tempDir);

  console.log("  ✅ Passed: Ingestion respects ATS precedence, collapses duplicates, and scores discovery jobs");
}

// [Test 7] Missing optional fields become null rather than fabricated
console.log("\n[Test 7] Schema purity: Missing fields default to null");
{
  const tempDir = path.join(ROOT, "data/test_fixtures2");
  fs.mkdirSync(tempDir, { recursive: true });
  const testScanPath = path.join(tempDir, "test_scan_results.json");
  const testDiscPath = path.join(tempDir, "test_discovery_results.json");

  fs.writeFileSync(testScanPath, JSON.stringify({ jobs: [] }), "utf8");
  fs.writeFileSync(testDiscPath, JSON.stringify({
    jobs: [
      {
        source: "smart_scraper",
        company: "Okta",
        title: "Software Engineer",
        url: "https://okta.com/jobs/123",
        location: "Bangalore"
      }
    ]
  }), "utf8");

  ingestDiscovery({ discoveryPath: testDiscPath, scanResultsPath: testScanPath, silent: true });
  const updatedScan = JSON.parse(fs.readFileSync(testScanPath, "utf8"));
  const job = updatedScan.jobs[0];

  assert.strictEqual(job.apply_url, null);
  assert.strictEqual(job.posted_at, null);
  assert.strictEqual(job.salary, null);
  assert.strictEqual(job.experience, null);
  assert.strictEqual(job.source_job_id, null);

  fs.unlinkSync(testScanPath);
  fs.unlinkSync(testDiscPath);
  fs.rmdirSync(tempDir);
  console.log("  ✅ Passed: Missing discovery fields are safely set to null without fabrication");
}

// [Test 8] Error safety: Malformed discovery file does not corrupt scan_results.json
console.log("\n[Test 8] Resilience: Malformed discovery file does not corrupt scan_results.json");
{
  const tempDir = path.join(ROOT, "data/test_fixtures3");
  fs.mkdirSync(tempDir, { recursive: true });
  const testScanPath = path.join(tempDir, "test_scan_results.json");
  const testDiscPath = path.join(tempDir, "test_discovery_results.json");

  const originalData = { scanned_at: "2026-08-23T00:00:00Z", total: 1, jobs: [{ company: "Test", title: "Test", score: 90 }] };
  fs.writeFileSync(testScanPath, JSON.stringify(originalData), "utf8");
  fs.writeFileSync(testDiscPath, "{ malformed json: not valid }", "utf8");

  const res = ingestDiscovery({ discoveryPath: testDiscPath, scanResultsPath: testScanPath, silent: true });
  assert.strictEqual(res.success, false);

  const preserved = JSON.parse(fs.readFileSync(testScanPath, "utf8"));
  assert.strictEqual(preserved.jobs.length, 1);
  assert.strictEqual(preserved.jobs[0].company, "Test");

  fs.unlinkSync(testScanPath);
  fs.unlinkSync(testDiscPath);
  fs.rmdirSync(tempDir);
  console.log("  ✅ Passed: Malformed discovery payload fails cleanly without touching scan_results.json");
}

// [Test 9] Staffing / Consultancy Risk Detection
console.log("\n[Test 9] Staffing / consultancy risk detection");
import { detectDiscoveryRisk, computeJobScore, classifyJob } from "../scripts/ingest-discovery.mjs";
{
  const portals = readPortals();
  const lookup = buildCompanyLookup(portals);

  // Clear staffing agencies
  assert.strictEqual(detectDiscoveryRisk("TRUSTKLUB Consulting", "Backend Engineer", "", lookup), "staffing_agency_risk");
  assert.strictEqual(detectDiscoveryRisk("Creative Hands HR", "AI Engineer", "", lookup), "staffing_agency_risk");
  assert.strictEqual(detectDiscoveryRisk("Leading Client", "Platform Engineer", "", lookup), "staffing_agency_risk");
  assert.strictEqual(detectDiscoveryRisk("Le Human Resources Solutions", "SDE II", "", lookup), "staffing_agency_risk");

  // Legitimate tech & product companies
  assert.strictEqual(detectDiscoveryRisk("Sparta Systems", "Software Engr I - .Net", "", lookup), "normal");
  assert.strictEqual(detectDiscoveryRisk("Ellicium Solutions", "Senior Software Engineer", "", lookup), "normal");
  assert.strictEqual(detectDiscoveryRisk("Barclays", "Platform Engineer", "", lookup), "normal");
  assert.strictEqual(detectDiscoveryRisk("Postman", "Backend Engineer", "", lookup), "normal");
  assert.strictEqual(detectDiscoveryRisk("Amazon", "SDE II", "", lookup), "normal");
  console.log("  ✅ Passed: Staffing agency risk detected accurately without false positives on legitimate employers");
}

// [Test 10] Null posted_at does not receive artificial freshness bonus
console.log("\n[Test 10] Null posted_at date does not receive artificial freshness points");
{
  const config = { roles: ["Backend Engineer"], locations: ["Pune"], experienceFilter: "2-4", freshnessDays: 30 };
  
  const freshJob = {
    title: "Backend Engineer",
    company: "Test Corp",
    priority: "GOOD",
    location: "Pune",
    posted_at: new Date().toISOString() // hot: 0 days old
  };
  const freshClass = classifyJob(freshJob, config);
  const freshScore = computeJobScore(freshJob, freshClass, config);

  const nullDateJob = {
    title: "Backend Engineer",
    company: "Test Corp",
    priority: "GOOD",
    location: "Pune",
    posted_at: null // unstated date
  };
  const nullClass = classifyJob(nullDateJob, config);
  const nullScore = computeJobScore(nullDateJob, nullClass, config);

  assert.strictEqual(nullClass.freshness_confidence, "unknown");
  assert.strictEqual(freshScore.score - nullScore.score, 5, "Hot posting receives +5 freshness bonus, null date receives 0");
  console.log("  ✅ Passed: Missing posted_at date receives unknown confidence and no artificial freshness boost");
}

console.log("\n========================================================");
console.log("🎉 ALL 10 DISCOVERY INGESTION & RISK TESTS PASSED!");
console.log("========================================================\n");

#!/usr/bin/env node
/**
 * scripts/coverage.mjs — Coverage Metrics and Diagnostics Report
 * 
 * Reports company universe coverage, verified sources, job inventory,
 * and location breakdown across all tracked Indian employers.
 * 
 * Run:  npm run coverage
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function loadFile(relPath, isYaml = true) {
  const p = path.join(ROOT, relPath);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return isYaml ? yaml.load(raw) : JSON.parse(raw);
}

function main() {
  const candidatesData = loadFile("portals/candidates.yml", true) || { companies: [] };
  const indiaData = loadFile("portals/india.yml", true) || {};
  const migrationsData = loadFile("portals/migrations.yml", true) || {};
  const scanData = loadFile("data/scan_results.json", false) || { total: 0, jobs: [] };
  const discoveryData = loadFile("data/source_discovery.json", false) || { total: 0, results: [] };

  const universe = candidatesData.companies || [];
  const verifiedInPortals = Object.values(indiaData).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0);

  // Status breakdown
  const statusCounts = { verified: 0, needs_verification: 0, unsupported: 0, defunct: 0 };
  for (const c of universe) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  }

  // Source breakdown in universe
  const universeSourceCounts = {};
  for (const c of universe) {
    const s = c.ats || "unassigned";
    universeSourceCounts[s] = (universeSourceCounts[s] || 0) + 1;
  }

  // Active verified boards
  const activeBoardCounts = {};
  for (const [board, list] of Object.entries(indiaData)) {
    if (Array.isArray(list)) activeBoardCounts[board] = list.length;
  }

  // Active job stats
  const jobs = scanData.jobs || [];
  const primaryJobs = jobs.filter(j => !j.is_stretch);
  const stretchJobs = jobs.filter(j => j.is_stretch);

  // Tier stats
  let tier1Scanned = 0, tier2Scanned = 0;
  for (const list of Object.values(indiaData)) {
    if (Array.isArray(list)) {
      list.forEach(co => {
        if (co.tier === "1") tier1Scanned++;
        else tier2Scanned++;
      });
    }
  }

  // Location stats from matched jobs
  const locCounts = {};
  for (const j of jobs) {
    let loc = j.remote ? "Remote" : (j.location || "India").split(",")[0].trim();
    if (/bangalore|bengaluru/i.test(loc)) loc = "Bangalore";
    else if (/hyderabad/i.test(loc)) loc = "Hyderabad";
    else if (/pune/i.test(loc)) loc = "Pune";
    else if (/delhi|gurgaon|gurugram|noida/i.test(loc)) loc = "Gurgaon / Delhi NCR";
    else if (/mumbai|navi mumbai/i.test(loc)) loc = "Mumbai";
    else if (/chennai/i.test(loc)) loc = "Chennai";
    locCounts[loc] = (locCounts[loc] || 0) + 1;
  }

  console.log(`\n${"═".repeat(65)}`);
  console.log(`📊 CAREER-OPS-INDIA COVERAGE METRICS`);
  console.log(`${"═".repeat(65)}\n`);

  console.log(`🏢 COMPANY COVERAGE`);
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`  • Total Company Universe:     ${universe.length}`);
  console.log(`  • Verified / Scannable:        ${verifiedInPortals} (${((verifiedInPortals / universe.length) * 100).toFixed(1)}%)`);
  console.log(`  • Needs Verification / Setup:  ${statusCounts.needs_verification || 0}`);
  console.log(`  • Unsupported / Protected:     ${statusCounts.unsupported || 0}`);
  console.log(`  • Defunct / Inactive:          ${statusCounts.defunct || 0}\n`);

  console.log(`🔌 ACTIVE SOURCE COVERAGE (portals/india.yml)`);
  console.log(`─────────────────────────────────────────────────────────────`);
  Object.entries(activeBoardCounts).forEach(([board, count]) => {
    console.log(`  • ${board.padEnd(20)} ${count} verified companies`);
  });
  console.log(`  Total Active:          ${verifiedInPortals} verified companies\n`);

  console.log(`💼 JOB INVENTORY COVERAGE (data/scan_results.json)`);
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`  • Total Eligible Jobs:         ${jobs.length}`);
  console.log(`  • Primary Sweet-Spot Matches:  ${primaryJobs.length} (2–4 YOE IC SDE)`);
  console.log(`  • Stretch IC Opportunities:    ${stretchJobs.length} (Lead/Staff/Principal/5-7 YOE)\n`);

  console.log(`🏆 TIER COVERAGE`);
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`  • Tier 1 Companies Scanned:    ${tier1Scanned}`);
  console.log(`  • Tier 2 Companies Scanned:    ${tier2Scanned}\n`);

  console.log(`📍 LOCATION DISTRIBUTION (Matched Jobs)`);
  console.log(`─────────────────────────────────────────────────────────────`);
  Object.entries(locCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([loc, count]) => {
      console.log(`  • ${loc.padEnd(25)} ${count} jobs`);
    });

  console.log(`\n${"═".repeat(65)}\n`);
}

main();

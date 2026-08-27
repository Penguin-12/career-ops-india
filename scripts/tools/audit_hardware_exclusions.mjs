/**
 * scripts/audit_hardware_exclusions.mjs — Hardware & DFT Exclusions Audit Script
 * 
 * Audits all scanned jobs against the hardware/silicon/DFT exclusion gates.
 * Run: node scripts/audit_hardware_exclusions.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isHardwareSiliconExclusion } from "../taxonomy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const SCAN_FILE = path.join(ROOT, "data/scan_results.json");

if (!fs.existsSync(SCAN_FILE)) {
  console.error("data/scan_results.json not found. Run 'npm run scan' first.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8"));
const jobs = data.jobs || [];

console.log(`Auditing ${jobs.length} jobs in data/scan_results.json for hardware/silicon/DFT exclusions...\n`);

let excludedCount = 0;
for (const j of jobs) {
  if (isHardwareSiliconExclusion(j.title)) {
    console.log(`❌ Excluded: [${j.company}] ${j.title} (${j.location})`);
    excludedCount++;
  }
}

console.log(`\nAudit Complete: ${excludedCount} hardware/silicon/DFT exclusions detected among active jobs.`);


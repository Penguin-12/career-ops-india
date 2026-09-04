#!/usr/bin/env node
/**
 * scripts/test-runner.mjs — Zero-Config Automated Test Runner
 * 
 * Auto-discovers and executes all test suites in the `tests/` directory.
 * No need to edit package.json when adding new tests.
 * 
 * Usage:
 *   npm test                  # Runs all tests in tests/
 *   npm test -- phonepe       # Runs only tests matching "phonepe"
 *   npm test -- taxonomy      # Runs only tests matching "taxonomy"
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const TESTS_DIR = path.resolve(process.cwd(), "tests");
const filterArg = process.argv.slice(2).find(a => !a.startsWith("-"))?.toLowerCase();

if (!fs.existsSync(TESTS_DIR)) {
  console.error(`❌ Tests directory not found at: ${TESTS_DIR}`);
  process.exit(1);
}

const allFiles = fs.readdirSync(TESTS_DIR)
  .filter(file => (file.startsWith("test-") || file.endsWith(".test.mjs")) && file.endsWith(".mjs"))
  .sort();

const testFiles = filterArg
  ? allFiles.filter(f => f.toLowerCase().includes(filterArg))
  : allFiles;

if (testFiles.length === 0) {
  console.log(`⚠️ No test files found matching filter: "${filterArg}"`);
  console.log(`Available test files:\n  • ${allFiles.join("\n  • ")}`);
  process.exit(0);
}

console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`🧪 CAREER-OPS INDIA — RUNNING ${testFiles.length} TEST SUITE${testFiles.length === 1 ? "" : "S"}`);
if (filterArg) console.log(`🔍 Filter: "${filterArg}"`);
console.log(`══════════════════════════════════════════════════════════════\n`);

const results = [];
const suiteStart = Date.now();

for (const file of testFiles) {
  const filePath = path.join(TESTS_DIR, file);
  const start = Date.now();
  
  const child = spawnSync(process.execPath, [filePath], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" }
  });

  const durationMs = Date.now() - start;
  const passed = child.status === 0;

  results.push({
    file,
    passed,
    exitCode: child.status,
    durationMs
  });

  if (!passed) {
    console.error(`\n❌ FAILED: ${file} (Exit code: ${child.status}, ${durationMs}ms)\n`);
  }
}

const totalDuration = ((Date.now() - suiteStart) / 1000).toFixed(2);
const passedCount = results.filter(r => r.passed).length;
const failedCount = results.filter(r => !r.passed).length;

console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`📊 TEST EXECUTION SUMMARY (${totalDuration}s)`);
console.log(`══════════════════════════════════════════════════════════════`);

results.forEach(r => {
  const icon = r.passed ? "✅ PASS" : "❌ FAIL";
  const time = `(${r.durationMs}ms)`.padStart(10);
  console.log(`  ${icon}  ${r.file.padEnd(35)} ${time}`);
});

console.log(`──────────────────────────────────────────────────────────────`);
console.log(`Total Suites: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
console.log(`══════════════════════════════════════════════════════════════\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log(`🎉 ALL ${passedCount} TEST SUITES PASSED CLEANLY!\n`);
  process.exit(0);
}

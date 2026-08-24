#!/usr/bin/env node
/**
 * scripts/queue.mjs — Daily Curated Application Queue
 * 
 * Answers: "Which 10–20 jobs should Josh apply to today?"
 * Ranks all scanned jobs deterministically using Company Priority,
 * Technical Function Fit, Level Fit, Location Preference, and Freshness.
 * 
 * Run:  node scripts/queue.mjs
 * Run:  npm run queue
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const RESULTS_PATH = path.join(ROOT, "data/scan_results.json");

if (!fs.existsSync(RESULTS_PATH)) {
  console.log("No scan_results.json found. Run: npm run scan first.");
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
const jobs = data.jobs || [];

if (jobs.length === 0) {
  console.log("No eligible matches found in scan_results.json.");
  process.exit(0);
}

import { diversifyJobs, partitionQueue, formatLabel } from "./queue-core.mjs";
import { loadApplicationState, filterJobsByState } from "./state-service.mjs";
import { loadJobLifecycleState, filterJobsByLifecycle } from "./job-lifecycle-service.mjs";

export { diversifyJobs, partitionQueue, formatLabel };

function printJobCard(j, rank) {
  const detScore = j.score ?? "N/A";
  const priority = j.priority || "GOOD";
  const fresh = j.freshness_tier === "hot" ? "🟢 Hot (0–7d)" : (j.freshness_tier === "fresh" ? "🟡 Fresh (8–14d)" : "⚪ Active (15–30d)");
  const roleLabel = formatLabel(j.role_family || j.function || "general_sde");
  const seniorityLabel = formatLabel(j.job_seniority || j.seniority || j.level || "unknown");
  const fitLabel = formatLabel(j.experience_fit || j.fit || "primary");
  const alignLabel = formatLabel(j.career_alignment || "high");
  const rationale = (j.score_reasons || []).slice(0, 3).join("; ").replace(/\+/g, "").trim();

  const ai = j.ai_evaluation;
  if (ai) {
    const aiBadge = ai.recommendation === "APPLY" ? "🟢 APPLY" : (ai.recommendation === "CONSIDER" ? "🟡 CONSIDER" : "⚪ SKIP");
    console.log(`\n  ${String(rank).padStart(2)}. [${ai.ai_score}/100 AI] [${aiBadge}] [${priority}] ${j.company} — ${j.title}`);
    console.log(`     📍 ${(j.location || "India").padEnd(24)} |  🕒 ${fresh} (${j.age_days ?? 0}d old)`);
    console.log(`     📊 Deterministic: ${detScore}/100 | AI Score: ${ai.ai_score}/100 (Confidence: ${ai.confidence || "HIGH"})`);
    console.log(`     🏷️  Role: ${roleLabel} | Seniority: ${seniorityLabel} | Experience: ${fitLabel} | Career alignment: ${alignLabel}`);
    if (ai.why_apply) {
      console.log(`     💡 Why Apply: ${ai.why_apply}`);
    }
    if (ai.why_not) {
      console.log(`     ⚠️  Why Not: ${ai.why_not}`);
    }
    if (ai.strengths && ai.strengths.length > 0) {
      console.log(`     ✨ Strengths: ${ai.strengths.slice(0, 2).join(" | ")}`);
    }
    if (ai.gaps && ai.gaps.length > 0) {
      console.log(`     🔍 Gaps: ${ai.gaps.slice(0, 2).join(" | ")}`);
    }
  } else {
    console.log(`\n  ${String(rank).padStart(2)}. [${detScore}/100] [${priority}] ${j.company} — ${j.title}`);
    console.log(`     📍 ${(j.location || "India").padEnd(24)} |  🕒 ${fresh} (${j.age_days ?? 0}d old)  |  🤖 AI: Not evaluated`);
    console.log(`     🏷️  Role: ${roleLabel} | Seniority: ${seniorityLabel} | Experience fit: ${fitLabel} | Career alignment: ${alignLabel}`);
    if (rationale) {
      console.log(`     💡 Match Rationale: ${rationale}`);
    }
  }
  console.log(`     🔗 ${j.url}`);
}

const appState = loadApplicationState();
const lifecycleState = loadJobLifecycleState();
const { active: unActioned } = filterJobsByState(jobs, appState);
const { active: activeEligible } = filterJobsByLifecycle(unActioned, lifecycleState);

const q = partitionQueue(activeEligible, 5);

console.log(`\n${"═".repeat(72)}`);
console.log(`🎯 CAREER-OPS-INDIA — DAILY APPLICATION QUEUE`);
console.log(`${"═".repeat(72)}`);
console.log(`Total Candidates Evaluated: ${data.total} eligible matches | Scanned: ${new Date(data.scanned_at || Date.now()).toLocaleDateString()}`);

let currentRank = 1;

if (q.apply.length > 0) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`🔥 1. AI VERIFIED — APPLY NOW (${q.apply.length} Top Priority Recommendations)`);
  console.log(`${"─".repeat(72)}`);
  q.apply.forEach(j => printJobCard(j, currentRank++));
}

if (q.consider.length > 0) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`🟡 2. AI EVALUATED — CONSIDER / BACKUP (${q.consider.length} Opportunities)`);
  console.log(`${"─".repeat(72)}`);
  q.consider.forEach(j => printJobCard(j, currentRank++));
}

const topUnevaluated = q.unevaluated.slice(0, Math.max(10, 30 - currentRank + 1));
if (topUnevaluated.length > 0) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`📋 3. NOT YET AI EVALUATED (Top Deterministic Candidates)`);
  console.log(`${"─".repeat(72)}`);
  topUnevaluated.forEach(j => printJobCard(j, currentRank++));
}

if (q.skip.length > 0) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`⚪ 4. AI EVALUATED — SKIPPED (${q.skip.length} Filtered Noise / Mismatches)`);
  console.log(`${"─".repeat(72)}`);
  q.skip.forEach(j => printJobCard(j, currentRank++));
}

console.log(`\n${"═".repeat(72)}`);
console.log(`Next Steps:`);
console.log(`  1. /evaluate [URL]   → Score against your profile & check resume match`);
console.log(`  2. /apply [URL]      → Tailor resume & track application status`);
console.log(`  3. npm run dashboard → Open visual Kanban pipeline & daily queue`);
console.log(`${"═".repeat(72)}\n`);

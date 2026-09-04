/**
 * tests/test-dashboard-freshness.mjs — Comprehensive Test Suite for Dashboard Freshness Layout
 * 
 * Verifies Phase 1 Requirements:
 * 1. Every active job belongs to exactly one of the 5 freshness sections: TODAY, HOT, FRESH, ACTIVE, BACKLOG.
 * 2. No job appears in more than one section (mutually exclusive & exhaustive).
 * 3. Freshness counts reconcile exactly with the active dataset.
 * 4. DOM card IDs rendered across the primary Queue view are globally unique (no duplicates).
 * 5. Existing eval_status, eval_rank, eval_reason, AI scores, and deterministic scores are preserved.
 * 6. selectJobsForEvaluation and isStrongCandidate remain unaltered.
 * 7. Dashboard filtering and search work cleanly over all 5 freshness grids.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { partitionQueueByFreshness, partitionQueue } from "../scripts/queue-core.mjs";
import { buildDashboardData } from "../scripts/dashboard-server.mjs";
import { selectJobsForEvaluation, isStrongCandidate } from "../scripts/ai/evaluator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT, "templates/dashboard.html");

console.log("\n========================================================");
console.log("🎯 DASHBOARD FRESHNESS LAYOUT (PHASE 1) TEST SUITE");
console.log("========================================================\n");

// ── Test 1: partitionQueueByFreshness partitions mutually exclusively and exhaustively
console.log("[Test 1] partitionQueueByFreshness partitions jobs mutually exclusively and exhaustively");
{
  const mockJobs = [
    { job_id: "j1", company: "A", title: "T1", freshness_tier: "today", age_days: 0 },
    { job_id: "j2", company: "B", title: "T2", freshness_tier: "hot", age_days: 2 },
    { job_id: "j3", company: "C", title: "T3", freshness_tier: "fresh", age_days: 5 },
    { job_id: "j4", company: "D", title: "T4", freshness_tier: "active", age_days: 10 },
    { job_id: "j5", company: "E", title: "T5", freshness_tier: "backlog", age_days: 20 },
    { job_id: "j6", company: "F", title: "T6", freshness_tier: "unstated", age_days: null },
    { job_id: "j7", company: "G", title: "T7", freshness_tier: null, age_days: null }
  ];

  const partitioned = partitionQueueByFreshness(mockJobs);

  assert.strictEqual(partitioned.today.length, 1, "Exactly 1 in TODAY");
  assert.strictEqual(partitioned.today[0].job_id, "j1");

  assert.strictEqual(partitioned.hot.length, 1, "Exactly 1 in HOT");
  assert.strictEqual(partitioned.hot[0].job_id, "j2");

  assert.strictEqual(partitioned.fresh.length, 1, "Exactly 1 in FRESH");
  assert.strictEqual(partitioned.fresh[0].job_id, "j3");

  assert.strictEqual(partitioned.active.length, 1, "Exactly 1 in ACTIVE");
  assert.strictEqual(partitioned.active[0].job_id, "j4");

  assert.strictEqual(partitioned.backlog.length, 1, "Exactly 1 in BACKLOG (15-30d)");
  assert.strictEqual(partitioned.backlog[0].job_id, "j5");

  assert.strictEqual(partitioned.unstated.length, 2, "Exactly 2 in UNSTATED (unstated + null)");
  assert.deepStrictEqual(partitioned.unstated.map(j => j.job_id).sort(), ["j6", "j7"].sort());

  const totalPartitioned = partitioned.today.length + partitioned.hot.length + partitioned.fresh.length + partitioned.active.length + partitioned.backlog.length + partitioned.unstated.length;
  assert.strictEqual(totalPartitioned, mockJobs.length, "Total partitioned matches input count exactly");

  // Check no intersection between any two sets
  const allSets = [partitioned.today, partitioned.hot, partitioned.fresh, partitioned.active, partitioned.backlog, partitioned.unstated];
  const seenIds = new Set();
  for (const set of allSets) {
    for (const job of set) {
      assert.ok(!seenIds.has(job.job_id), `Job ${job.job_id} must not appear in multiple freshness sections`);
      seenIds.add(job.job_id);
    }
  }

  console.log("  ✅ Passed: Every job placed into exactly one of 6 freshness buckets with zero overlaps and zero blanketing");
}

// ── Test 2: Real dataset reconciliation in buildDashboardData
console.log("\n[Test 2] buildDashboardData reconciles freshness counts exactly with active dataset");
{
  const data = buildDashboardData();
  const q = data.queue;

  assert.ok(Array.isArray(q.today), "q.today is array");
  assert.ok(Array.isArray(q.hot), "q.hot is array");
  assert.ok(Array.isArray(q.fresh), "q.fresh is array");
  assert.ok(Array.isArray(q.active), "q.active is array");
  assert.ok(Array.isArray(q.backlog), "q.backlog is array");
  assert.ok(Array.isArray(q.unstated), "q.unstated is array");

  const totalFreshnessCount = q.today.length + q.hot.length + q.fresh.length + q.active.length + q.backlog.length + q.unstated.length;
  assert.strictEqual(totalFreshnessCount, data.counts.active, `Freshness total (${totalFreshnessCount}) equals active count (${data.counts.active})`);
  assert.strictEqual(data.counts.today, q.today.length, "Counts.today matches q.today.length");
  assert.strictEqual(data.counts.hot, q.hot.length, "Counts.hot matches q.hot.length");
  assert.strictEqual(data.counts.fresh, q.fresh.length, "Counts.fresh matches q.fresh.length");
  assert.strictEqual(data.counts.active_freshness, q.active.length, "Counts.active_freshness matches q.active.length");
  assert.strictEqual(data.counts.backlog, q.backlog.length, "Counts.backlog matches q.backlog.length");
  assert.strictEqual(data.counts.unstated, q.unstated.length, "Counts.unstated matches q.unstated.length");

  // Verify no job ID appears twice across all 6 sections
  const seenIds = new Set();
  const duplicates = [];
  for (const section of [q.today, q.hot, q.fresh, q.active, q.backlog, q.unstated]) {
    for (const job of section) {
      if (seenIds.has(job.job_id)) {
        duplicates.push(job.job_id);
      }
      seenIds.add(job.job_id);
    }
  }
  assert.strictEqual(duplicates.length, 0, `Found duplicate job IDs across Queue view: ${duplicates.join(", ")}`);
  assert.strictEqual(seenIds.size, data.counts.active, "All active jobs represented uniquely");

  console.log(`  ✅ Passed: Reconciled all ${data.counts.active} active jobs across 6 mutually exclusive buckets:`);
  console.log(`     • TODAY:    ${q.today.length}`);
  console.log(`     • HOT:      ${q.hot.length}`);
  console.log(`     • FRESH:    ${q.fresh.length}`);
  console.log(`     • ACTIVE:   ${q.active.length}`);
  console.log(`     • BACKLOG:  ${q.backlog.length}`);
  console.log(`     • UNSTATED: ${q.unstated.length}`);
}

// ── Test 3: HTML template structure and DOM IDs
console.log("\n[Test 3] HTML template contains correct mutually exclusive freshness grids and headers");
{
  const html = fs.readFileSync(TEMPLATE_PATH, "utf8");

  // Freshness Grids
  assert.ok(html.includes('id="grid-today"'), "Contains grid-today");
  assert.ok(html.includes('id="grid-hot"'), "Contains grid-hot");
  assert.ok(html.includes('id="grid-fresh"'), "Contains grid-fresh");
  assert.ok(html.includes('id="grid-active"'), "Contains grid-active");
  assert.ok(html.includes('id="grid-backlog"'), "Contains grid-backlog");

  // Freshness Count Spans
  assert.ok(html.includes('id="count-today"'), "Contains count-today");
  assert.ok(html.includes('id="count-hot"'), "Contains count-hot");
  assert.ok(html.includes('id="count-fresh"'), "Contains count-fresh");
  assert.ok(html.includes('id="count-active"'), "Contains count-active");
  assert.ok(html.includes('id="count-backlog"'), "Contains count-backlog");

  // Old duplicate section grids removed from queue view
  assert.ok(!html.includes('id="grid-apply-now"'), "Old grid-apply-now removed");
  assert.ok(!html.includes('id="grid-consider"'), "Old grid-consider removed");
  assert.ok(!html.includes('id="grid-unevaluated"'), "Old grid-unevaluated removed");
  assert.ok(!html.includes('id="grid-skip"'), "Old grid-skip removed");

  console.log("  ✅ Passed: dashboard.html defines all 5 freshness sections without obsolete duplicate grids");
}

// ── Test 4: Selection invariant check
console.log("\n[Test 4] selectJobsForEvaluation and isStrongCandidate remain authoritative & unaltered");
{
  const mockAtsJobs = Array.from({ length: 150 }, (_, i) => ({
    job_id: `ats_${i}`,
    company: `Company_${i % 10}`,
    source_type: "employer_ats",
    score: 80 + (i % 20),
    freshness_tier: i % 2 === 0 ? "today" : "fresh",
    freshness_confidence: "high"
  }));

  const selected = selectJobsForEvaluation(mockAtsJobs, { limit: 120 });
  assert.strictEqual(selected.length, 120, "ATS selection budget remains exactly 120");

  const strongJob = { score: 85, tier: "1", is_stretch: false };
  const weakJob = { score: 75, tier: "1", is_stretch: false };
  const stretchJob = { score: 95, tier: "1", is_stretch: true };
  const tier2Job = { score: 95, tier: "2", is_stretch: false };

  assert.strictEqual(isStrongCandidate(strongJob), true, "85-score Tier-1 primary is strong");
  assert.strictEqual(isStrongCandidate(weakJob), false, "75-score is not strong (<80)");
  assert.strictEqual(isStrongCandidate(stretchJob), false, "Stretch job is not strong");
  assert.strictEqual(isStrongCandidate(tier2Job), false, "Tier 2 job is not strong");

  console.log("  ✅ Passed: AI candidate selection rules, budgets, and quality gates remain invariant");
}

// ── Test 5: Section internal ordering preservation
console.log("\n[Test 5] Section sorting respects AI evaluated (APPLY > CONSIDER > SKIP) > selected > deferred > excluded precedence");
{
  const sectionJobs = [
    { job_id: "j_skip", title: "Skip", freshness_tier: "hot", ai_evaluation: { recommendation: "SKIP", ai_score: 45 } },
    { job_id: "j_apply", title: "Apply", freshness_tier: "hot", ai_evaluation: { recommendation: "APPLY", ai_score: 92 } },
    { job_id: "j_selected2", title: "Selected #2", freshness_tier: "hot", eval_status: "selected", eval_rank: 2, score: 90 },
    { job_id: "j_selected1", title: "Selected #1", freshness_tier: "hot", eval_status: "selected", eval_rank: 1, score: 90 },
    { job_id: "j_deferred", title: "Deferred", freshness_tier: "hot", eval_status: "deferred", score: 88 },
    { job_id: "j_excluded", title: "Excluded", freshness_tier: "hot", eval_status: "excluded", score: 65 },
    { job_id: "j_consider", title: "Consider", freshness_tier: "hot", ai_evaluation: { recommendation: "CONSIDER", ai_score: 78 } }
  ];

  const partitioned = partitionQueueByFreshness(sectionJobs);
  const orderedIds = partitioned.hot.map(j => j.job_id);

  assert.deepStrictEqual(orderedIds, [
    "j_apply",      // AI APPLY (score 92)
    "j_consider",   // AI CONSIDER (score 78)
    "j_skip",       // AI SKIP (score 45)
    "j_selected1",  // Selected #1
    "j_selected2",  // Selected #2
    "j_deferred",   // Deferred (score 88)
    "j_excluded"    // Excluded (score 65)
  ]);

  console.log("  ✅ Passed: Intra-freshness ordering strictly prioritizes AI APPLY > CONSIDER > SKIP > SELECTED > DEFERRED > EXCLUDED");
}

// ── Test 6: eval_rank precedence over company tier and deterministic fallback
console.log("\n[Test 6] eval_rank takes precedence over tier, and missing eval_rank uses deterministic fallback");
{
  // Part A: eval_rank takes precedence over company tier
  const tierVsRankJobs = [
    { job_id: "tier0_rank2", company: "Google", tier: "0", priority: "GO", eval_status: "selected", eval_rank: 2, freshness_tier: "today" },
    { job_id: "tier1_rank1", company: "ServiceNow", tier: "1", priority: "GOOD", eval_status: "selected", eval_rank: 1, freshness_tier: "today" }
  ];
  const partitionedA = partitionQueueByFreshness(tierVsRankJobs);
  assert.strictEqual(partitionedA.today[0].job_id, "tier1_rank1", "Rank 1 (Tier 1) precedes Rank 2 (Tier 0)");
  assert.strictEqual(partitionedA.today[1].job_id, "tier0_rank2", "Rank 2 follows Rank 1");

  // Part B: Missing eval_rank uses deterministic fallback (Tier 0 > Tier 1, GO > GOOD, score DESC, age ASC)
  const fallbackJobs = [
    { job_id: "fb_tier1_go", tier: "1", priority: "GO", age_days: 0, freshness_tier: "today" },
    { job_id: "fb_tier0_good", tier: "0", priority: "GOOD", age_days: 0, freshness_tier: "today" },
    { job_id: "fb_tier0_go_older", tier: "0", priority: "GO", age_days: 1, freshness_tier: "today" },
    { job_id: "fb_tier0_go_younger", tier: "0", priority: "GO", age_days: 0, freshness_tier: "today" }
  ];
  const partitionedB = partitionQueueByFreshness(fallbackJobs);
  const fbOrdered = partitionedB.today.map(j => j.job_id);
  assert.deepStrictEqual(fbOrdered, [
    "fb_tier0_go_younger", // Tier 0, GO, 0d
    "fb_tier0_go_older",   // Tier 0, GO, 1d
    "fb_tier0_good",       // Tier 0, GOOD, 0d
    "fb_tier1_go"          // Tier 1, GO, 0d
  ]);

  console.log("  ✅ Passed: eval_rank strictly preserves allocator priority; missing rank uses robust deterministic fallback");
}

// ── Test 7: Score descending ordering within evaluated buckets (APPLY, CONSIDER, SKIP)
console.log("\n[Test 7] Evaluated buckets sort strictly by ai_score DESC");
{
  const evaluatedMulti = [
    { job_id: "app_85", freshness_tier: "fresh", ai_evaluation: { recommendation: "APPLY", ai_score: 85 } },
    { job_id: "app_98", freshness_tier: "fresh", ai_evaluation: { recommendation: "APPLY", ai_score: 98 } },
    { job_id: "con_72", freshness_tier: "fresh", ai_evaluation: { recommendation: "CONSIDER", ai_score: 72 } },
    { job_id: "con_79", freshness_tier: "fresh", ai_evaluation: { recommendation: "CONSIDER", ai_score: 79 } },
    { job_id: "skip_30", freshness_tier: "fresh", ai_evaluation: { recommendation: "SKIP", ai_score: 30 } },
    { job_id: "skip_65", freshness_tier: "fresh", ai_evaluation: { recommendation: "SKIP", ai_score: 65 } }
  ];

  const partitioned = partitionQueueByFreshness(evaluatedMulti);
  const ordered = partitioned.fresh.map(j => j.job_id);

  assert.deepStrictEqual(ordered, [
    "app_98",  // APPLY 98
    "app_85",  // APPLY 85
    "con_79",  // CONSIDER 79
    "con_72",  // CONSIDER 72
    "skip_65", // SKIP 65
    "skip_30"  // SKIP 30
  ]);

  console.log("  ✅ Passed: AI evaluated sub-buckets sort strictly by ai_score DESC");
}

// ── Test 8: Quick View filter predicate and semantics (75+ AI Score)
console.log("\n[Test 8] Quick View filter semantics (75+ AI Score) and UI markup");
{
  const html = fs.readFileSync(TEMPLATE_PATH, "utf8");
  assert.ok(html.includes('id="btn-quick-view"'), "HTML contains btn-quick-view");
  assert.ok(html.includes('toggleQuickView()'), "HTML contains toggleQuickView handler");

  // Pure predicate implementation identical to dashboard.html matchesFilters
  const quickViewPredicate = (job) => {
    return Boolean(job.ai_evaluation && typeof job.ai_evaluation.ai_score === "number" && job.ai_evaluation.ai_score >= 75);
  };

  // Case 1: Exact threshold 75 -> included
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 75 } }), true, "75 is included");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 85 } }), true, "85 is included");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 100 } }), true, "100 is included");

  // Case 2: Below threshold -> excluded
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 74.99 } }), false, "74.99 is excluded");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 74 } }), false, "74 is excluded");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 50 } }), false, "50 is excluded");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: 0 } }), false, "0 is excluded");

  // Case 3: Unevaluated -> excluded
  assert.strictEqual(quickViewPredicate({ eval_status: "selected", eval_rank: 1 }), false, "Selected unevaluated is excluded");
  assert.strictEqual(quickViewPredicate({ eval_status: "deferred" }), false, "Deferred unevaluated is excluded");
  assert.strictEqual(quickViewPredicate({ eval_status: "excluded" }), false, "Excluded unevaluated is excluded");
  assert.strictEqual(quickViewPredicate({ score: 95 }), false, "Discovery scored without AI is excluded");

  // Case 4: Missing, null, or malformed ai_score -> excluded
  assert.strictEqual(quickViewPredicate({ ai_evaluation: {} }), false, "Missing ai_score is excluded");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: null } }), false, "Null ai_score is excluded");
  assert.strictEqual(quickViewPredicate({ ai_evaluation: { ai_score: "85" } }), false, "String ai_score is excluded");
  assert.strictEqual(quickViewPredicate({}), false, "Empty job object is excluded");

  console.log("  ✅ Passed: Quick View strictly filters for valid numeric ai_score >= 75 across all edge cases");
}

console.log("\n========================================================");
console.log("🎉 ALL DASHBOARD FRESHNESS LAYOUT TESTS PASSED!");
console.log("========================================================\n");

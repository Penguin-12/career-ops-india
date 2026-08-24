/**
 * scripts/queue-core.mjs — Reusable Queue Partitioning, Ranking & Diversification
 * 
 * Provides deterministic queue partitioning and company diversification logic.
 * Consumed by CLI queue runner (scripts/queue.mjs), daily pipeline, and dashboard.
 */

/**
 * Enforces company diversification by capping the number of jobs per company
 * in the active selected set, while preserving score ordering in both sets.
 */
export function diversifyJobs(jobList, maxPerCompany = 5) {
  const companyCounts = new Map();
  const selected = [];
  const overflow = [];

  for (const job of jobList) {
    const co = String(job.company || "unknown").toLowerCase().trim();
    const count = companyCounts.get(co) || 0;
    if (count < maxPerCompany) {
      companyCounts.set(co, count + 1);
      selected.push(job);
    } else {
      overflow.push(job);
    }
  }

  return { selected, overflow };
}

/**
 * Partitions a job list into AI APPLY, AI CONSIDER, AI SKIP, and UNEVALUATED buckets.
 * - AI evaluated jobs take strict precedence based on recommendation and ai_score descending.
 * - Unevaluated jobs are sorted by deterministic score descending.
 * - Applies company diversification cap (default 5) to the AI APPLY bucket.
 */
export function partitionQueue(jobList, maxPerCompany = 5) {
  const aiApply = [];
  const aiConsider = [];
  const aiSkip = [];
  const unevaluated = [];

  for (const job of jobList) {
    if (job.ai_evaluation) {
      const rec = String(job.ai_evaluation.recommendation || "").toUpperCase();
      if (rec === "APPLY") aiApply.push(job);
      else if (rec === "CONSIDER") aiConsider.push(job);
      else aiSkip.push(job);
    } else {
      unevaluated.push(job);
    }
  }

  aiApply.sort((a, b) => (b.ai_evaluation?.ai_score ?? 0) - (a.ai_evaluation?.ai_score ?? 0));
  aiConsider.sort((a, b) => (b.ai_evaluation?.ai_score ?? 0) - (a.ai_evaluation?.ai_score ?? 0));
  aiSkip.sort((a, b) => (b.ai_evaluation?.ai_score ?? 0) - (a.ai_evaluation?.ai_score ?? 0));
  unevaluated.sort((a, b) => (b.score || 0) - (a.score || 0));

  const { selected: applySelected, overflow: applyOverflow } = diversifyJobs(aiApply, maxPerCompany);

  return {
    apply: applySelected,
    applyOverflow,
    consider: aiConsider,
    skip: aiSkip,
    unevaluated
  };
}

export function formatLabel(val) {
  return String(val || "unknown").replace(/_/g, " ").toUpperCase();
}


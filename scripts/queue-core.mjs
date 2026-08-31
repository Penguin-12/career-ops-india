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
  const today = [];
  const aiApply = [];
  const aiConsider = [];
  const aiSkip = [];
  const unevaluated = [];

  for (const job of jobList) {
    const isToday = job.freshness_tier === "today" && job.lifecycle?.status !== "expired";
    const rec = job.ai_evaluation ? String(job.ai_evaluation.recommendation || "").toUpperCase() : null;

    if (job.ai_evaluation) {
      if (rec === "APPLY") {
        aiApply.push(job);
        if (isToday) today.push(job);
      } else if (rec === "CONSIDER") {
        aiConsider.push(job);
        if (isToday) today.push(job);
      } else {
        aiSkip.push(job);
      }
    } else {
      unevaluated.push(job);
      if (isToday) today.push(job);
    }
  }

  aiApply.sort((a, b) => (b.ai_evaluation?.ai_score ?? 0) - (a.ai_evaluation?.ai_score ?? 0));
  aiConsider.sort((a, b) => (b.ai_evaluation?.ai_score ?? 0) - (a.ai_evaluation?.ai_score ?? 0));
  aiSkip.sort((a, b) => (b.ai_evaluation?.ai_score ?? 0) - (a.ai_evaluation?.ai_score ?? 0));
  unevaluated.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Sort today: AI APPLY first (by ai_score desc), then AI CONSIDER (by ai_score desc), then UNEVALUATED (by det score desc)
  today.sort((a, b) => {
    const aPriority = a.ai_evaluation?.recommendation === "APPLY" ? 0 : (a.ai_evaluation?.recommendation === "CONSIDER" ? 1 : 2);
    const bPriority = b.ai_evaluation?.recommendation === "APPLY" ? 0 : (b.ai_evaluation?.recommendation === "CONSIDER" ? 1 : 2);
    if (aPriority !== bPriority) return aPriority - bPriority;

    if (a.ai_evaluation?.ai_score != null && b.ai_evaluation?.ai_score != null) {
      return b.ai_evaluation.ai_score - a.ai_evaluation.ai_score;
    }
    return (b.score || 0) - (a.score || 0);
  });

  const { selected: applySelected, overflow: applyOverflow } = diversifyJobs(aiApply, maxPerCompany);

  return {
    today,
    apply: applySelected,
    applyOverflow,
    applyAll: [...applySelected, ...applyOverflow],
    consider: aiConsider,
    skip: aiSkip,
    unevaluated
  };
}

export function formatLabel(val) {
  return String(val || "unknown").replace(/_/g, " ").toUpperCase();
}


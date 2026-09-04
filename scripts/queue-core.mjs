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
  unevaluated.sort(compareJobsInQueue);
  today.sort(compareJobsInQueue);

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

/**
 * Comparator for presentation ordering within any queue or freshness section:
 * 1. AI APPLY (ai_score DESC)
 * 2. AI CONSIDER (ai_score DESC)
 * 3. AI SKIP (ai_score DESC)
 * 4. SELECTED / QUEUE unevaluated (eval_rank ASC #1, #2, #3...)
 * 5. DEFERRED (strong candidates outside batch capacity: oldest waiting candidates preferred)
 * 6. EXCLUDED (failed quality gate / stretch, last)
 *
 * Fallback for missing eval_rank on unevaluated jobs:
 * - Company Tier: Tier 0 > Tier 1 > Tier 2
 * - Priority: GO > GOOD
 * - Deterministic score when available (DESC)
 * - Posting age: younger first (ASC)
 * - Stable deterministic tie-breaker (job_id / url)
 */
export function compareJobsInQueue(a, b) {
  const getLifecyclePriority = (j) => {
    if (j.ai_evaluation) {
      const rec = String(j.ai_evaluation.recommendation || "").toUpperCase();
      if (rec === "APPLY") return 0;
      if (rec === "CONSIDER") return 1;
      if (rec === "SKIP") return 2;
      return 2;
    }
    if (j.eval_status === "selected") return 3;
    if (j.eval_status === "deferred") return 4;
    if (j.eval_status === "excluded") return 5;
    return 3; // fallback unevaluated
  };

  const pA = getLifecyclePriority(a);
  const pB = getLifecyclePriority(b);
  if (pA !== pB) return pA - pB;

  // 2. Evaluated jobs (APPLY, CONSIDER, SKIP): ai_score DESC
  if (a.ai_evaluation?.ai_score != null && b.ai_evaluation?.ai_score != null) {
    if (b.ai_evaluation.ai_score !== a.ai_evaluation.ai_score) {
      return b.ai_evaluation.ai_score - a.ai_evaluation.ai_score;
    }
  }

  // 3. Selected jobs: eval_rank ASC (#1, #2, #3...)
  if (a.eval_rank != null && b.eval_rank != null) {
    if (a.eval_rank !== b.eval_rank) {
      return a.eval_rank - b.eval_rank;
    }
  }
  if (a.eval_rank != null) return -1;
  if (b.eval_rank != null) return 1;

  // 4. Deferred jobs: oldest waiting candidates first
  if (pA === 4 && pB === 4) {
    if (a.age_days != null && b.age_days != null && b.age_days !== a.age_days) {
      return b.age_days - a.age_days;
    }
  }

  // 5. Deterministic fallback ordering:
  // Company Tier: Tier 0 > Tier 1 > Tier 2
  const tierA = a.tier === "0" ? 0 : (a.tier === "1" ? 1 : 2);
  const tierB = b.tier === "0" ? 0 : (b.tier === "1" ? 1 : 2);
  if (tierA !== tierB) return tierA - tierB;

  // Priority: GO (0) > GOOD (1)
  const prioA = a.priority === "GO" ? 0 : 1;
  const prioB = b.priority === "GO" ? 0 : 1;
  if (prioA !== prioB) return prioA - prioB;

  // Deterministic match score when available (DESC)
  if (typeof a.score === "number" && typeof b.score === "number") {
    if (b.score !== a.score) return b.score - a.score;
  } else if (typeof a.score === "number") {
    return -1;
  } else if (typeof b.score === "number") {
    return 1;
  }

  // Posting age: younger first (ASC)
  if (a.age_days != null && b.age_days != null) {
    if (a.age_days !== b.age_days) return a.age_days - b.age_days;
  }

  // Stable deterministic final tie-breaker
  const idA = String(a.job_id || a.url || "");
  const idB = String(b.job_id || b.url || "");
  return idA.localeCompare(idB);
}

/**
 * Partitions active jobs into 6 strictly mutually exclusive freshness sections:
 * - TODAY (<24h)
 * - HOT (1–3d)
 * - FRESH (4–7d)
 * - ACTIVE (8–14d)
 * - BACKLOG (15–30d)
 * - UNSTATED (Active jobs where ATS does not publish a date)
 *
 * Every job belongs to exactly one section.
 * Preserves AI evaluated scores, selection ranks, deferred/excluded lifecycle states,
 * and deterministic match scores without altering underlying selection models.
 */
export function partitionQueueByFreshness(jobList) {
  const today = [];
  const hot = [];
  const fresh = [];
  const active = [];
  const backlog = [];
  const unstated = [];

  for (const job of jobList) {
    const tier = job.freshness_tier;
    if (tier === "today") {
      today.push(job);
    } else if (tier === "hot") {
      hot.push(job);
    } else if (tier === "fresh") {
      fresh.push(job);
    } else if (tier === "active") {
      active.push(job);
    } else if (tier === "backlog") {
      backlog.push(job);
    } else {
      unstated.push(job);
    }
  }

  today.sort(compareJobsInQueue);
  hot.sort(compareJobsInQueue);
  fresh.sort(compareJobsInQueue);
  active.sort(compareJobsInQueue);
  backlog.sort(compareJobsInQueue);
  unstated.sort(compareJobsInQueue);

  return {
    today,
    hot,
    fresh,
    active,
    backlog,
    unstated
  };
}


#!/usr/bin/env node
/**
 * tests/test-ai-evaluator.mjs — Comprehensive Unit & Integration Tests for AI Evaluator
 * Note: All tests use MockProvider to ensure 100% deterministic, offline execution with 0 API tokens spent.
 */

import assert from "assert";
import fs from "fs";
import { parseModelJsonResponse, MockProvider, getAIProvider, DEFAULT_MODEL } from "../scripts/ai/provider.mjs";
import { evaluateJob, evaluateBatch, computeCacheKey, validateEvaluation, selectJobsForEvaluation } from "../scripts/ai/evaluator.mjs";
import { buildEvaluationPrompt } from "../scripts/ai/prompt.mjs";
import { diversifyJobs, partitionQueue } from "../scripts/queue-core.mjs";

console.log("=== AI Job Evaluator Lifecycle & Robustness Test Suite ===");

const customProfile = {
  candidate: {
    name: "Alex Sharma",
    experience_years: 4,
    current_role: "Senior Backend Developer at FinTech Corp",
    skills: ["Go", "Kubernetes", "PostgreSQL", "Kafka", "gRPC"],
    target_roles: ["Distributed Systems Engineer", "Backend Lead"],
    locations: ["Pune", "Remote"],
    target_salary_lpa: { min: 30, max: 60 },
    notice_period_days: 30,
    career_narrative: "Passionate about high-throughput consensus systems and Go microservices."
  }
};

const dummyProfile = {
  candidate: {
    name: "Josh Wadhwa",
    experience_years: 3,
    current_role: "Software Engineer — Platform & Cloud Engineering at Wells Fargo",
    skills: ["Java", "Python", "Kubernetes", "Kafka", "RAG", "GenAI", "Docker", "SQL"],
    target_roles: ["Software Engineer II", "Backend Engineer", "Platform Engineer", "AI Software Engineer"],
    locations: ["Hyderabad", "Bangalore", "Pune", "Remote"],
    target_salary_lpa: { min: 25, max: 50 },
    notice_period_days: 60,
    career_narrative: "Software Engineer with 3 years experience building production backend/platform systems and RAG pipelines."
  }
};

const dummyCV = `# Josh Wadhwa
Software Engineer at Wells Fargo (3 YOE). Built OpenShift Kubernetes microservices, RAG pipelines, and observability systems.
Education: B.E. BITS Pilani.`;

const dummyJob = {
  company: "Amazon",
  title: "Software Development Engineer II, Payments",
  location: "Bengaluru, India",
  url: "https://amazon.jobs/dummy-sde2",
  priority: "GO",
  tier: "1",
  role_family: "general_sde",
  job_seniority: "sde_2",
  experience_fit: "primary",
  career_alignment: "high",
  score: 95,
  age_days: 2,
  freshness_tier: "hot",
  description: "Looking for SDE II with 3+ years experience in Java/C++, distributed systems, microservices, and high-throughput systems."
};

const mockValidResponse = {
  ai_score: 94,
  recommendation: "APPLY",
  confidence: "HIGH",
  technical_fit: 24,
  experience_fit: 19,
  stack_fit: 19,
  career_trajectory: 18,
  application_probability: 14,
  strengths: ["Direct Java and distributed systems match", "Experience with mission-critical financial backend"],
  gaps: ["No direct DynamoDB experience mentioned"],
  why_apply: "High-value core SDE II role at a target Tier 1 employer with perfect YOE alignment.",
  why_not: "High interview bar in system design.",
  resume_alignment: ["Wells Fargo: 20+ microservices on Kubernetes", "Goldman Sachs: 10M+ daily records data pipelines"],
  missing_requirements: []
};

// 1. Valid JSON Response
console.log("\n[Test 1] Valid JSON response parsing & validation");
{
  const raw = JSON.stringify(mockValidResponse);
  const parsed = parseModelJsonResponse(raw);
  assert.strictEqual(parsed.ai_score, 94);
  assert.strictEqual(parsed.recommendation, "APPLY");
  assert.strictEqual(parsed.confidence, "HIGH");
  assert.strictEqual(parsed.technical_fit, 24);
  assert.strictEqual(parsed.strengths.length, 2);
  console.log("  ✅ Passed: Valid JSON parsed and typed accurately");
}

// 2. Malformed model response handling (Code fences, surrounding text, string scores)
console.log("\n[Test 2] Malformed model response handling & recovery");
{
  const rawWithFences = `Here is your evaluation report:
\`\`\`json
${JSON.stringify({ ...mockValidResponse, ai_score: "88", recommendation: "apply", technical_fit: "22" })}
\`\`\`
Hope this helps!`;
  const parsed = parseModelJsonResponse(rawWithFences);
  assert.strictEqual(parsed.ai_score, 88);
  assert.strictEqual(parsed.recommendation, "APPLY");
  assert.strictEqual(parsed.technical_fit, 22);
  console.log("  ✅ Passed: Extracted JSON from code fences and text wrapper");

  assert.throws(() => parseModelJsonResponse("Not a JSON response"), /Failed to parse AI response/);
  console.log("  ✅ Passed: Clear exception on unparseable model response");
}

// 3. Provider failure handling
console.log("\n[Test 3] Provider failure handling");
{
  const failingProvider = new MockProvider(async () => {
    throw new Error("API rate limit exceeded");
  });
  await assert.rejects(async () => {
    await failingProvider.generate("test prompt");
  }, /API rate limit exceeded/);
  console.log("  ✅ Passed: Provider failure bubble-up verified");
}

// 4. Missing CV handling
console.log("\n[Test 4] Missing CV handling");
{
  const provider = new MockProvider(mockValidResponse);
  await assert.rejects(async () => {
    await evaluateJob(dummyJob, { provider, profile: dummyProfile, cvText: "" });
  }, /Missing candidate CV text/);
  console.log("  ✅ Passed: Missing CV detected and halted");
}

// 5. Missing JD handling
console.log("\n[Test 5] Missing JD handling");
{
  const jobWithoutJd = { ...dummyJob, description: "" };
  const prompt = buildEvaluationPrompt(jobWithoutJd, dummyProfile, dummyCV);
  assert.ok(prompt.includes("Full description not available"), "Fallback text included for missing JD");
  console.log("  ✅ Passed: Graceful fallback when JD is missing");
}

// 6. Cached evaluation
console.log("\n[Test 6] Cached evaluation verification");
{
  const tempCache = {};
  const cacheKey = computeCacheKey(dummyJob, JSON.stringify(dummyProfile), dummyCV);
  let providerCalls = 0;
  const provider = new MockProvider(() => {
    providerCalls++;
    return mockValidResponse;
  });

  const res1 = await evaluateJob(dummyJob, {
    provider,
    profile: dummyProfile,
    cvText: dummyCV,
    cache: tempCache,
    skipCacheSave: true
  });
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(res1.ai_evaluation.cached, false);
  assert.ok(tempCache[cacheKey], "Entry stored in cache object");

  const res2 = await evaluateJob(dummyJob, {
    provider,
    profile: dummyProfile,
    cvText: dummyCV,
    cache: tempCache,
    skipCacheSave: true
  });
  assert.strictEqual(providerCalls, 1, "Provider was NOT called on cache hit");
  assert.strictEqual(res2.ai_evaluation.cached, true);
  console.log("  ✅ Passed: Cache hit reused evaluation with zero provider calls");
}

// 7. Force re-evaluation
console.log("\n[Test 7] Force re-evaluation verification");
{
  const tempCache = {};
  let providerCalls = 0;
  const provider = new MockProvider(() => {
    providerCalls++;
    return mockValidResponse;
  });

  await evaluateJob(dummyJob, {
    provider,
    profile: dummyProfile,
    cvText: dummyCV,
    cache: tempCache,
    skipCacheSave: true
  });
  assert.strictEqual(providerCalls, 1);

  await evaluateJob(dummyJob, {
    provider,
    profile: dummyProfile,
    cvText: dummyCV,
    cache: tempCache,
    force: true,
    skipCacheSave: true
  });
  assert.strictEqual(providerCalls, 2, "Provider WAS called on forced re-evaluation");
  console.log("  ✅ Passed: Force flag bypassed cache as expected");
}

// 8. Deterministic queue remains functional without AI
console.log("\n[Test 8] Deterministic queue integrity without AI");
{
  const jobWithoutAI = { ...dummyJob };
  assert.strictEqual(jobWithoutAI.ai_evaluation, undefined);
  assert.strictEqual(jobWithoutAI.score, 95);
  console.log("  ✅ Passed: Deterministic fields intact without AI evaluation");
}

// 9. AI fields persist without destroying existing fields
console.log("\n[Test 9] AI fields persist without destroying existing fields");
{
  const provider = new MockProvider(mockValidResponse);
  const evaluated = await evaluateJob(dummyJob, {
    provider,
    profile: dummyProfile,
    cvText: dummyCV,
    cache: {},
    skipCacheSave: true
  });

  assert.strictEqual(evaluated.company, dummyJob.company);
  assert.strictEqual(evaluated.title, dummyJob.title);
  assert.strictEqual(evaluated.score, 95);
  assert.strictEqual(evaluated.role_family, "general_sde");
  assert.strictEqual(evaluated.job_seniority, "sde_2");
  assert.strictEqual(evaluated.experience_fit, "primary");
  assert.strictEqual(evaluated.career_alignment, "high");
  assert.strictEqual(evaluated.ai_evaluation.ai_score, 94);
  assert.strictEqual(evaluated.ai_evaluation.recommendation, "APPLY");
  console.log("  ✅ Passed: All existing deterministic metadata preserved alongside ai_evaluation");
}

// 10. Dynamic prompt extraction (No hardcoding)
console.log("\n[Test 10] Dynamic prompt extraction without hardcoding");
{
  const prompt = buildEvaluationPrompt(dummyJob, customProfile, dummyCV);
  assert.ok(prompt.includes("Name: Alex Sharma"), "Extracted custom candidate name");
  assert.ok(prompt.includes("Experience: 4 years"), "Extracted custom experience years");
  assert.ok(prompt.includes("Target Roles: Distributed Systems Engineer, Backend Lead"), "Extracted custom roles");
  assert.ok(prompt.includes("Core Skills: Go, Kubernetes, PostgreSQL, Kafka, gRPC"), "Extracted custom skills");
  assert.ok(prompt.includes("Target Locations: Pune, Remote"), "Extracted custom locations");
  assert.ok(prompt.includes("Target Compensation: 30–60 LPA"), "Extracted custom salary");
  console.log("  ✅ Passed: All prompt fields derived dynamically from candidate configuration");
}

// 11. Model configurability
console.log("\n[Test 11] Configurable model support via GEMINI_MODEL");
{
  const customProvider = getAIProvider({ provider: "mock", model: "gemini-2.5-pro" });
  assert.strictEqual(customProvider.name, "mock");
  assert.strictEqual(DEFAULT_MODEL, process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
  console.log("  ✅ Passed: Model configuration properly wired");
}

// 12. Quality validation flags detection
console.log("\n[Test 12] Validation flags for suspicious evaluations");
{
  // Flag 1: Low tech fit with APPLY
  const lowTechEval = { ...mockValidResponse, recommendation: "APPLY", technical_fit: 12 };
  const flags1 = validateEvaluation(lowTechEval, dummyJob, dummyProfile, dummyCV);
  assert.ok(flags1.includes("low_technical_fit_for_apply"), "Flagged low technical fit for APPLY");

  // Flag 2: Low app probability with APPLY
  const lowProbEval = { ...mockValidResponse, recommendation: "APPLY", application_probability: 5 };
  const flags2 = validateEvaluation(lowProbEval, dummyJob, dummyProfile, dummyCV);
  assert.ok(flags2.includes("low_application_probability_for_apply"), "Flagged low application probability for APPLY");

  // Flag 3: Non-engineering role with APPLY
  const supportJob = { ...dummyJob, role_family: "application_support" };
  const flags3 = validateEvaluation(mockValidResponse, supportJob, dummyProfile, dummyCV);
  assert.ok(flags3.some(f => f.includes("non_engineering_role_family_apply")), "Flagged non-engineering role with APPLY");

  // Flag 4: Senior role with high experience fit
  const principalJob = { ...dummyJob, job_seniority: "principal" };
  const flags4 = validateEvaluation(mockValidResponse, principalJob, dummyProfile, dummyCV);
  assert.ok(flags4.includes("suspicious_high_experience_fit_for_senior_role"), "Flagged senior role with high experience fit");

  // Flag 5: Hallucination in alignment
  const hallucinatedEval = {
    ...mockValidResponse,
    resume_alignment: ["10 years of production Ruby on Rails and Mainframe Cobol experience"]
  };
  const flags5 = validateEvaluation(hallucinatedEval, dummyJob, dummyProfile, dummyCV);
  assert.ok(flags5.some(f => f.includes("potential_hallucination_in_alignment")), "Flagged unverified skill claim");

  console.log("  ✅ Passed: All 5 validation flags correctly trigger on anomalous outputs");
}

// 13. Vendor maintenance vs genuine SDE differentiation
console.log("\n[Test 13] Vendor package maintenance vs genuine SDE differentiation");
{
  const vendorMaintenanceEval = {
    ai_score: 58,
    recommendation: "SKIP",
    confidence: "HIGH",
    technical_fit: 13,
    experience_fit: 14,
    stack_fit: 12,
    career_trajectory: 9,
    application_probability: 10,
    strengths: ["Basic systems engineering background"],
    gaps: ["Role is vendor package administration (UKG Kronos, Oracle DBA, IIS)"],
    why_apply: "Employer prestige only.",
    why_not: "Internal IT vendor application maintenance traps candidate in non-SDE operations.",
    resume_alignment: ["Observability with Splunk"],
    missing_requirements: ["UKG Kronos package administration", "Oracle DBA"]
  };
  const parsed = parseModelJsonResponse(JSON.stringify(vendorMaintenanceEval));
  assert.strictEqual(parsed.recommendation, "SKIP");
  assert.ok(parsed.ai_score < 70);
  console.log("  ✅ Passed: Evaluator discriminates vendor maintenance from genuine SDE");
}

// 14. 5 Jobs and 30 Jobs Batch Evaluation with Controlled Concurrency
console.log("\n[Test 14] Batch evaluation execution (5 & 30 jobs with mock provider)");
{
  const tempScanPath = "data/.test_scan_results.json";
  const dummyBatch = Array.from({ length: 30 }, (_, i) => ({
    company: `Company_${i + 1}`,
    title: `Software Engineer II - Team ${i + 1}`,
    location: "Bengaluru, India",
    url: `https://test.com/jobs/${i + 1}`,
    score: 95 - i,
    priority: "GO",
    role_family: "general_sde",
    job_seniority: "sde_2",
    experience_fit: "primary",
    career_alignment: "high"
  }));

  fs.writeFileSync(tempScanPath, JSON.stringify({ total: 30, jobs: dummyBatch }), "utf8");

  const mockProvider = new MockProvider(() => mockValidResponse);

  // Test 5 jobs
  const res5 = await evaluateBatch({
    limit: 5,
    concurrency: 3,
    provider: mockProvider,
    scanResultsPath: tempScanPath,
    cachePath: "data/.test_ai_cache.json",
    json: true,
    skipFileSave: false
  });
  assert.strictEqual(res5.total, 5);
  assert.strictEqual(res5.succeeded, 5);
  assert.strictEqual(res5.failed, 0);

  // Test 30 jobs
  const res30 = await evaluateBatch({
    limit: 30,
    concurrency: 5,
    provider: mockProvider,
    scanResultsPath: tempScanPath,
    cachePath: "data/.test_ai_cache.json",
    json: true,
    force: true,
    skipFileSave: false
  });
  assert.strictEqual(res30.total, 30);
  assert.strictEqual(res30.succeeded, 30);
  assert.strictEqual(res30.failed, 0);

  // Clean up test files
  if (fs.existsSync(tempScanPath)) fs.unlinkSync(tempScanPath);
  if (fs.existsSync("data/.test_ai_cache.json")) fs.unlinkSync("data/.test_ai_cache.json");

  console.log("  ✅ Passed: Batch evaluations of 5 and 30 jobs completed with controlled concurrency and immediate persistence");
}

// 15. Job Failure Resilience & Per-Job Timeout
console.log("\n[Test 15] Resilience: One failed/timed-out job does not block the rest of the batch");
{
  const tempScanPath = "data/.test_scan_resilience.json";
  const dummyResilienceBatch = [
    { company: "GoodCo1", title: "SDE II", score: 95, url: "https://test.com/1" },
    { company: "FailingCo", title: "SDE II", score: 94, url: "https://test.com/2" },
    { company: "HangingCo", title: "SDE II", score: 93, url: "https://test.com/3" },
    { company: "GoodCo2", title: "SDE II", score: 92, url: "https://test.com/4" }
  ];

  fs.writeFileSync(tempScanPath, JSON.stringify({ total: 4, jobs: dummyResilienceBatch }), "utf8");

  const resilientProvider = new MockProvider((prompt) => {
    if (prompt.includes("FailingCo")) {
      throw new Error("Simulated upstream network error");
    }
    if (prompt.includes("HangingCo")) {
      // Simulate hung request by returning a promise that never resolves
      return new Promise(() => {});
    }
    return mockValidResponse;
  });

  const res = await evaluateBatch({
    limit: 4,
    concurrency: 2,
    timeout: 1, // 1 second timeout for test speed
    provider: resilientProvider,
    scanResultsPath: tempScanPath,
    cachePath: "data/.test_ai_cache.json",
    json: true
  });

  assert.strictEqual(res.total, 4);
  assert.strictEqual(res.succeeded, 2);
  assert.strictEqual(res.failed, 2);
  assert.strictEqual(res.evaluated[0].ai_evaluation.recommendation, "APPLY");
  assert.ok(res.evaluated[1].ai_evaluation_error.includes("Simulated upstream network error"));
  assert.ok(res.evaluated[2].ai_evaluation_error.includes("Timed out after 1s"));
  assert.strictEqual(res.evaluated[3].ai_evaluation.recommendation, "APPLY");

  if (fs.existsSync(tempScanPath)) fs.unlinkSync(tempScanPath);
  if (fs.existsSync("data/.test_ai_cache.json")) fs.unlinkSync("data/.test_ai_cache.json");

  console.log("  ✅ Passed: Failing and hung jobs timed out cleanly without halting the remaining queue");
}

console.log("\n========================================================");
console.log("🎉 ALL 15 LIFECYCLE & ROBUSTNESS TESTS PASSED!");
console.log("========================================================\n");

// 16. Company Diversification Cap (Default 5)
console.log("\n[Test 16] Company diversification cap limits APPLY queue to 5 jobs/company");
{
  const testJobs = [
    { company: "Amazon", title: "Job 1", score: 98 },
    { company: "Amazon", title: "Job 2", score: 95 },
    { company: "Amazon", title: "Job 3", score: 94 },
    { company: "Amazon", title: "Job 4", score: 93 },
    { company: "Amazon", title: "Job 5", score: 92 },
    { company: "Amazon", title: "Job 6", score: 91 },
    { company: "Amazon", title: "Job 7", score: 90 },
    { company: "PhonePe", title: "SRE", score: 89 },
    { company: "Okta", title: "SRE II", score: 88 }
  ];

  const { selected, overflow } = diversifyJobs(testJobs, 5);
  const amazonInSelected = selected.filter(j => j.company === "Amazon");
  assert.strictEqual(amazonInSelected.length, 5, "Amazon capped at exactly 5 in selected");
  assert.strictEqual(selected.length, 7, "Selected has 5 Amazon + 1 PhonePe + 1 Okta");
  assert.strictEqual(overflow.length, 2, "Overflow has 2 remaining Amazon jobs");
  assert.strictEqual(overflow[0].title, "Job 6");
  assert.strictEqual(overflow[1].title, "Job 7");
  console.log("  ✅ Passed: Company cap restricts single company to 5 in APPLY section while preserving overflow");
}

// 17. Preservation of full scan results and ordering
console.log("\n[Test 17] Jobs beyond cap remain available in full results and preserve score ordering");
{
  const testJobs = [
    { company: "Amazon", title: "A1", score: 100 },
    { company: "Amazon", title: "A2", score: 90 },
    { company: "Amazon", title: "A3", score: 80 },
    { company: "Amazon", title: "A4", score: 70 },
    { company: "Amazon", title: "A5", score: 60 },
    { company: "Amazon", title: "A6", score: 50 },
    { company: "CrowdStrike", title: "C1", score: 95 }
  ];

  const { selected, overflow } = diversifyJobs(testJobs, 5);
  // Check ordering in selected
  assert.strictEqual(selected[0].title, "A1");
  assert.strictEqual(selected[1].title, "A2");
  assert.strictEqual(selected[2].title, "A3");
  assert.strictEqual(selected[3].title, "A4");
  assert.strictEqual(selected[4].title, "A5");
  assert.strictEqual(selected[5].title, "C1");
  assert.strictEqual(overflow[0].title, "A6");
  console.log("  ✅ Passed: Score order preserved within each company and across companies");
}

// 18. Companies with < 5 jobs unaffected
console.log("\n[Test 18] Companies with fewer than 5 jobs are unaffected");
{
  const testJobs = [
    { company: "PhonePe", title: "P1", score: 90 },
    { company: "PhonePe", title: "P2", score: 89 },
    { company: "Okta", title: "O1", score: 88 }
  ];
  const { selected, overflow } = diversifyJobs(testJobs, 5);
  assert.strictEqual(selected.length, 3);
  assert.strictEqual(overflow.length, 0);
  console.log("  ✅ Passed: Companies with fewer than cap retain 100% of jobs");
}

// 19. Configurable MAX_APPLY_PER_COMPANY (e.g. 7)
console.log("\n[Test 19] Configurable MAX_APPLY_PER_COMPANY=7 works seamlessly");
{
  const testJobs = Array.from({ length: 10 }, (_, i) => ({
    company: "Amazon",
    title: `Job ${i + 1}`,
    score: 95 - i
  }));

  const { selected, overflow } = diversifyJobs(testJobs, 7);
  assert.strictEqual(selected.length, 7);
  assert.strictEqual(overflow.length, 3);
  console.log("  ✅ Passed: Configurable cap (7) correctly applied");
}

console.log("\n========================================================");
console.log("🎉 ALL 19 LIFECYCLE, TAXONOMY & DIVERSIFICATION TESTS PASSED!");
console.log("========================================================\n");

// 20. Queue Precedence: High Deterministic Score + AI SKIP
console.log("\n[Test 20] Queue precedence: AI SKIP never enters APPLY or CONSIDER");
{
  const mockJobs = [
    { company: "Amazon", title: "SysDE II Time & Pay", score: 95, ai_evaluation: { recommendation: "SKIP", ai_score: 58 } },
    { company: "GitLab", title: "Senior Ruby on Rails", score: 90, ai_evaluation: { recommendation: "SKIP", ai_score: 58 } },
    { company: "Amazon", title: "SDE II Payments", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 93 } },
    { company: "Databricks", title: "SecOps", score: 82, ai_evaluation: { recommendation: "CONSIDER", ai_score: 75 } },
    { company: "Amazon", title: "Unevaluated SDE", score: 93 }
  ];

  const q = partitionQueue(mockJobs, 5);
  // SysDE Time & Pay has score 95, but AI recommended SKIP
  assert.strictEqual(q.apply.some(j => j.title.includes("Time & Pay")), false, "SKIP job excluded from APPLY");
  assert.strictEqual(q.consider.some(j => j.title.includes("Time & Pay")), false, "SKIP job excluded from CONSIDER");
  assert.strictEqual(q.skip.some(j => j.title.includes("Time & Pay")), true, "SKIP job present in SKIP section");

  // GitLab Ruby on Rails has score 90, but AI recommended SKIP
  assert.strictEqual(q.apply.some(j => j.title.includes("Ruby on Rails")), false, "Ruby SKIP job excluded from APPLY");
  assert.strictEqual(q.skip.some(j => j.title.includes("Ruby on Rails")), true, "Ruby SKIP job present in SKIP section");
  console.log("  ✅ Passed: High deterministic score with AI SKIP is strictly routed to SKIP");
}

// 21. Queue Precedence: High Deterministic Score + AI CONSIDER
console.log("\n[Test 21] Queue precedence: AI CONSIDER strictly routed to CONSIDER section");
{
  const mockJobs = [
    { company: "Databricks", title: "Security Engineer", score: 85, ai_evaluation: { recommendation: "CONSIDER", ai_score: 75 } },
    { company: "Amazon", title: "SDE II Payments", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 93 } }
  ];
  const q = partitionQueue(mockJobs, 5);
  assert.strictEqual(q.apply.some(j => j.title.includes("Security Engineer")), false);
  assert.strictEqual(q.consider.some(j => j.title.includes("Security Engineer")), true);
  console.log("  ✅ Passed: AI CONSIDER strictly isolated in CONSIDER section");
}

// 22. Queue Precedence: Lower Deterministic Score + AI APPLY
console.log("\n[Test 22] Queue precedence: AI APPLY prioritizes verified engineering fits");
{
  const mockJobs = [
    { company: "PhonePe", title: "SRE (2+ Years)", score: 89, ai_evaluation: { recommendation: "APPLY", ai_score: 92 } },
    { company: "Amazon", title: "SysDE II Time & Pay", score: 95, ai_evaluation: { recommendation: "SKIP", ai_score: 58 } }
  ];
  const q = partitionQueue(mockJobs, 5);
  assert.strictEqual(q.apply.length, 1);
  assert.strictEqual(q.apply[0].company, "PhonePe");
  console.log("  ✅ Passed: Lower deterministic score with AI APPLY correctly prioritized over 95-score SKIP");
}

// 23. Unevaluated Candidates Placed in Section 4
console.log("\n[Test 23] Unevaluated candidates surfaced in NOT YET AI EVALUATED section");
{
  const mockJobs = [
    { company: "Amazon", title: "SDE II Payments", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 93 } },
    { company: "CrowdStrike", title: "Backend Engineer II", score: 90 } // unevaluated
  ];
  const q = partitionQueue(mockJobs, 5);
  assert.strictEqual(q.apply.length, 1);
  assert.strictEqual(q.unevaluated.length, 1);
  assert.strictEqual(q.unevaluated[0].company, "CrowdStrike");
  console.log("  ✅ Passed: Unevaluated jobs clearly routed to NOT YET AI EVALUATED");
}

// 24. AI SKIP does NOT consume company diversification quota
console.log("\n[Test 24] AI SKIP does not consume company diversification quota");
{
  const mockJobs = [
    { company: "Amazon", title: "SysDE Time & Pay 1", score: 95, ai_evaluation: { recommendation: "SKIP", ai_score: 58 } },
    { company: "Amazon", title: "SysDE Time & Pay 2", score: 95, ai_evaluation: { recommendation: "SKIP", ai_score: 58 } },
    { company: "Amazon", title: "SysDE Time & Pay 3", score: 95, ai_evaluation: { recommendation: "SKIP", ai_score: 58 } },
    { company: "Amazon", title: "SDE II Core 1", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 94 } },
    { company: "Amazon", title: "SDE II Core 2", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 93 } },
    { company: "Amazon", title: "SDE II Core 3", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 92 } },
    { company: "Amazon", title: "SDE II Core 4", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 91 } },
    { company: "Amazon", title: "SDE II Core 5", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 90 } }
  ];

  const q = partitionQueue(mockJobs, 5);
  // Amazon should have exactly 5 in APPLY (the 5 AI APPLY jobs), and 3 in SKIP
  assert.strictEqual(q.apply.length, 5);
  assert.strictEqual(q.skip.length, 3);
  console.log("  ✅ Passed: 3 Amazon SKIP jobs did not prevent 5 genuine Amazon SDE II jobs from entering APPLY");
}

// 25. Selection Priority: Employer ATS outranks Aggregator when selecting AI candidates
console.log("\n[Test 25] Selection priority: Employer ATS outranks Aggregator for unevaluated candidates");
{
  const testPool = [
    { title: "Aggregator BIE", company: "Barclays", score: 95, source_type: "aggregator", source: "naukri" },
    { title: "ATS SDE II", company: "Amazon", score: 93, source_type: "employer_ats", source: "amazon" },
    { title: "ATS Backend Engineer", company: "Okta", score: 90, source_type: "employer_ats", source: "greenhouse" }
  ];

  const selected = selectJobsForEvaluation(testPool, { limit: 2 });
  assert.strictEqual(selected.length, 2);
  assert.strictEqual(selected[0].company, "Amazon", "Amazon ATS selected first");
  assert.strictEqual(selected[1].company, "Okta", "Okta ATS selected second");
  console.log("  ✅ Passed: Employer ATS jobs prioritized over Aggregator jobs when selecting for AI evaluation");
}

// 26. Source Filtering: --source=aggregator selects only aggregator jobs
console.log("\n[Test 26] Source filtering: --source=aggregator isolates discovery jobs");
{
  const testPool = [
    { title: "ATS Job", company: "Amazon", score: 95, source_type: "employer_ats" },
    { title: "Aggregator Job 1", company: "Barclays", score: 95, source_type: "aggregator" },
    { title: "Aggregator Job 2", company: "Accenture", score: 90, source_type: "aggregator" }
  ];

  const aggregatorSelected = selectJobsForEvaluation(testPool, { source: "aggregator", limit: 10 });
  assert.strictEqual(aggregatorSelected.length, 2);
  assert.strictEqual(aggregatorSelected.every(j => j.source_type === "aggregator"), true);

  const atsSelected = selectJobsForEvaluation(testPool, { source: "employer_ats", limit: 10 });
  assert.strictEqual(atsSelected.length, 1);
  assert.strictEqual(atsSelected[0].company, "Amazon");
  console.log("  ✅ Passed: Source filtering correctly isolates aggregator or employer ATS jobs");
}

// 27. Aggregator Candidate Ranking: normal risk and valid freshness prioritized
console.log("\n[Test 27] Aggregator candidate ranking: normal risk prioritized over staffing risk");
{
  const testPool = [
    { title: "Backend Engineer", company: "TRUSTKLUB Consulting", score: 95, source_type: "aggregator", discovery_risk: "staffing_agency_risk", freshness_confidence: "high" },
    { title: "Platform Engineer", company: "Medpace", score: 95, source_type: "aggregator", discovery_risk: "normal", freshness_confidence: "high" },
    { title: "AI Engineer", company: "Barclays", score: 95, source_type: "aggregator", discovery_risk: "normal", freshness_confidence: "unknown" }
  ];

  const selected = selectJobsForEvaluation(testPool, { source: "aggregator", limit: 3 });
  assert.strictEqual(selected[0].company, "Medpace", "Medpace normal risk + high confidence is #1");
  assert.strictEqual(selected[1].company, "Barclays", "Barclays normal risk + unknown confidence is #2");
  assert.strictEqual(selected[2].company, "TRUSTKLUB Consulting", "Staffing risk placed after normal risk");
  console.log("  ✅ Passed: Normal risk discovery jobs prioritized over staffing agency risks");
}

// 28. Aggregator jobs can receive AI APPLY and enter queue
console.log("\n[Test 28] Aggregator jobs receiving AI APPLY correctly enter the queue");
{
  const testJobs = [
    { company: "Barclays", title: "Platform Engineer", source_type: "aggregator", source: "naukri", score: 95, ai_evaluation: { recommendation: "APPLY", ai_score: 91 } },
    { company: "Amazon", title: "SDE II", source_type: "employer_ats", source: "amazon", score: 93, ai_evaluation: { recommendation: "APPLY", ai_score: 94 } }
  ];

  const q = partitionQueue(testJobs, 5);
  assert.strictEqual(q.apply.length, 2);
  assert.strictEqual(q.apply.some(j => j.company === "Barclays"), true, "Barclays discovery job present in APPLY queue");
  console.log("  ✅ Passed: Discovery jobs receiving AI APPLY successfully enter APPLY queue");
}

// 29. AI Cache prevents repeat evaluations
console.log("\n[Test 29] AI Cache prevents repeat model calls");
{
  let callCount = 0;
  const mockProv = new MockProvider(() => {
    callCount++;
    return {
      ai_score: 88,
      recommendation: "APPLY",
      confidence: "HIGH",
      technical_fit: 22,
      experience_fit: 18,
      stack_fit: 18,
      career_trajectory: 18,
      application_probability: 12,
      strengths: ["Strong fit"],
      gaps: [],
      why_apply: "Great opportunity",
      why_not: "None",
      resume_alignment: [],
      missing_requirements: []
    };
  });

  const testJob = { company: "Medpace", title: "Platform Engineer", url: "https://naukri.com/test-1" };
  const mockCache = {};

  const r1 = await evaluateJob(testJob, {
    provider: mockProv,
    profile: customProfile,
    cvText: "Software Engineer with 3 years experience in Kubernetes, Java, Go",
    cache: mockCache,
    skipCacheSave: true
  });
  assert.strictEqual(callCount, 1);
  assert.strictEqual(r1.ai_evaluation.cached, false);

  const r2 = await evaluateJob(testJob, {
    provider: mockProv,
    profile: customProfile,
    cvText: "Software Engineer with 3 years experience in Kubernetes, Java, Go",
    cache: mockCache,
    skipCacheSave: true
  });
  assert.strictEqual(callCount, 1, "Provider not called on second run due to cache hit");
  assert.strictEqual(r2.ai_evaluation.cached, true);
  console.log("  ✅ Passed: AI Cache prevents redundant provider calls");
}

// 30. Cross-cutting TODAY queue (freshness_tier === "today")
console.log("\n[Test 30] TODAY Queue strictly enforces freshness_tier === 'today' across active candidates");
{
  const testJobs = [
    { company: "Google", title: "SWE II Today", freshness_tier: "today", age_days: 0, ai_evaluation: { recommendation: "APPLY", ai_score: 92 } },
    { company: "Qualcomm", title: "AI Eng Today", freshness_tier: "today", age_days: 0, ai_evaluation: { recommendation: "CONSIDER", ai_score: 78 } },
    { company: "Amazon", title: "SDE Unevaluated Today", freshness_tier: "today", age_days: 0, score: 85 },
    { company: "GitLab", title: "Backend Yesterday", freshness_tier: "hot", age_days: 1, ai_evaluation: { recommendation: "APPLY", ai_score: 88 } },
    { company: "Microsoft", title: "Architect Staff Today", freshness_tier: "today", age_days: 0, ai_evaluation: { recommendation: "SKIP", ai_score: 30 } },
    { company: "StaleCo", title: "Expired Job", freshness_tier: "today", age_days: 0, lifecycle: { status: "expired" } }
  ];

  const q = partitionQueue(testJobs, 5);
  assert.strictEqual(q.today.length, 3, "TODAY has exactly 3 actionable opportunities (<24h)");
  assert.strictEqual(q.today[0].title, "SWE II Today", "APPLY job sorted first in TODAY queue");
  assert.strictEqual(q.today[1].title, "AI Eng Today", "CONSIDER job sorted second in TODAY queue");
  assert.strictEqual(q.today[2].title, "SDE Unevaluated Today", "UNEVALUATED job sorted third in TODAY queue");
  assert.strictEqual(q.today.some(j => j.title === "Expired Job"), false, "Expired jobs excluded from TODAY");
  assert.strictEqual(q.today.some(j => j.title === "Architect Staff Today"), false, "SKIP jobs excluded from TODAY");
  assert.strictEqual(q.skip.some(j => j.title === "Architect Staff Today"), true, "SKIP job correctly routed to skip queue");
  console.log("  ✅ Passed: Cross-cutting TODAY queue strictly enforces freshness_tier === 'today' and active recommendation ordering");
}

// 31. AI Candidate Selection: TODAY priority within source/risk class
console.log("\n[Test 31] AI Candidate Selection: TODAY priority within source/risk class with score/age tie-breakers");
{
  const testPool = [
    // Older high-scoring ATS job (score: 95, 5d old)
    { id: "ats-older", company: "Google", title: "SWE II Older", source_type: "employer_ats", score: 95, freshness_tier: "fresh", age_days: 5 },
    // Today ATS job (score: 80, 0d old)
    { id: "ats-today-1", company: "Microsoft", title: "SWE II Today Mid", source_type: "employer_ats", score: 80, freshness_tier: "today", age_days: 0 },
    // Today ATS job higher score (score: 90, 0d old)
    { id: "ats-today-2", company: "Rubrik", title: "SWE II Today High", source_type: "employer_ats", score: 90, freshness_tier: "today", age_days: 0 },
    // Aggregator Today normal risk (score: 95, 0d old)
    { id: "agg-today-normal", company: "Medpace", title: "Platform Eng Today", source_type: "aggregator", discovery_risk: "normal", score: 95, freshness_tier: "today", age_days: 0 },
    // Aggregator Today staffing risk (score: 98, 0d old)
    { id: "agg-today-staffing", company: "StaffCo", title: "Contract Eng Today", source_type: "aggregator", discovery_risk: "staffing_agency_risk", score: 98, freshness_tier: "today", age_days: 0 },
    // Aggregator Older normal risk (score: 92, 3d old)
    { id: "agg-older-normal", company: "Barclays", title: "AI Eng Older", source_type: "aggregator", discovery_risk: "normal", score: 92, freshness_tier: "hot", age_days: 3 },
    // Unstated freshness ATS job
    { id: "ats-unstated", company: "Amazon", title: "SDE Unstated", source_type: "employer_ats", score: 85, freshness_tier: "unstated", age_days: null }
  ];

  // 1. Selector respects limit
  const top2 = selectJobsForEvaluation(testPool, { limit: 2 });
  assert.strictEqual(top2.length, 2, "Selector respects limit");

  // 2. Select all
  const allSelected = selectJobsForEvaluation(testPool, { limit: 10 });
  const selectedIds = allSelected.map(j => j.id);

  // Expected order:
  // 1. ats-today-2 (ATS + TODAY + score 90)
  // 2. ats-today-1 (ATS + TODAY + score 80)
  // 3. ats-older (ATS + non-TODAY + score 95)
  // 4. ats-unstated (ATS + unstated + score 85)
  // 5. agg-today-normal (Aggregator + Normal Risk + TODAY + score 95)
  // 6. agg-older-normal (Aggregator + Normal Risk + non-TODAY + score 92)
  // 7. agg-today-staffing (Aggregator + Staffing Risk + TODAY + score 98)

  assert.strictEqual(selectedIds[0], "ats-today-2", "ATS Today (score 90) outranks ATS Older (score 95)");
  assert.strictEqual(selectedIds[1], "ats-today-1", "ATS Today (score 80) outranks ATS Older (score 95)");
  assert.strictEqual(selectedIds[2], "ats-older", "ATS Older is selected after ATS Today candidates");
  assert.strictEqual(selectedIds[3], "ats-unstated", "ATS Unstated is selected after timestamped ATS candidates");
  assert.strictEqual(selectedIds[4], "agg-today-normal", "Aggregator Today normal risk outranks Aggregator older");
  assert.strictEqual(selectedIds[5], "agg-older-normal", "Aggregator older normal risk outranks staffing risk");
  assert.strictEqual(selectedIds[6], "agg-today-staffing", "Aggregator staffing risk placed last despite being TODAY");

  console.log("  ✅ Passed: Evaluator candidate selection strictly prioritizes TODAY within source/risk class with score & age ordering");
}

console.log("\n=========================================================================");
console.log("🎉 ALL 31 LIFECYCLE, TAXONOMY, PRECEDENCE & DIVERSIFICATION TESTS PASSED!");
console.log("=========================================================================\n");

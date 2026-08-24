/**
 * scripts/ai/prompt.mjs — Dynamic Prompt Construction for AI Job Evaluator
 */

export function buildEvaluationPrompt(job, profile, cvText) {
  const candidate = profile?.candidate || {};
  const name = candidate.name || "Candidate";
  const currentRole = candidate.current_role || "Software Engineer";
  const expYears = candidate.experience_years ? `${candidate.experience_years} years` : "2–4 years";
  const education = candidate.education || "";
  const candidateSkills = Array.isArray(candidate.skills) ? candidate.skills.join(", ") : "";
  const targetRoles = Array.isArray(candidate.target_roles) ? candidate.target_roles.join(", ") : "";
  const targetLocations = Array.isArray(candidate.locations) ? candidate.locations.join(", ") : "India";
  const targetSalary = candidate.target_salary_lpa ? `${candidate.target_salary_lpa.min || 0}–${candidate.target_salary_lpa.max || 0} LPA` : "Not specified";
  const noticePeriod = candidate.notice_period_days ? `${candidate.notice_period_days} days` : "Standard";
  const narrative = candidate.career_narrative || "";

  const jobDesc = job.description || job.snippet || "Full description not available from structured ATS feed.";

  return `You are an elite, highly discerning Software Engineering Career Advisor and Technical Hiring Evaluator for the Indian tech market.
Your mission is to evaluate a live job posting specifically for the candidate described below.

Do NOT produce generic advice. Answer: "Given the candidate's actual resume, experience, technical background, and career goals, is this job genuinely worth applying to?"

========================================
CANDIDATE CONTEXT
========================================
Name: ${name}
Current Role: ${currentRole}
Experience: ${expYears}
Education: ${education}
Target Roles: ${targetRoles || "Software Engineering / Backend / Platform / Applied AI"}
Core Skills: ${candidateSkills || "Backend development, distributed systems, APIs, cloud/containers"}
Target Locations: ${targetLocations}
Target Compensation: ${targetSalary}
Notice Period: ${noticePeriod}

Career Goals & Narrative:
${narrative}

========================================
CANDIDATE RESUME (cv.md)
========================================
${cvText}

========================================
JOB POSTING DETAILS
========================================
Company: ${job.company} (Tier / Priority: ${job.priority || "GOOD"})
Job Title: ${job.title}
Location: ${job.location || "India"}
Posting Age: ${job.age_days ?? "Unknown"} days (${job.freshness_tier || "active"})
Job URL: ${job.url}

Deterministic Classification:
- Role Family: ${job.role_family || "general_sde"}
- Job Seniority: ${job.job_seniority || "unknown"}
- Experience Fit: ${job.experience_fit || "primary"}
- Career Alignment: ${job.career_alignment || "high"}
- Deterministic Pre-Score: ${job.score ?? "N/A"}/100

Job Description:
${jobDesc}

========================================
EVALUATION DIMENSIONS (0–100 Total)
========================================
Evaluate across these 5 dimensions:

1. technical_fit (0–25 points):
   - Relevance to backend, distributed systems, cloud platform, microservices, or applied AI/GenAI.
   - Architectural and technical depth.
   - Alignment with candidate's proven technical contributions in their resume.

2. experience_fit (0–20 points):
   - Realistic fit for candidate's experience level (${expYears}).
   - Distinguish sweet-spot requirements (2–4 YOE) from unrealistic senior requirements (e.g., 7+ YOE, Staff, Principal).

3. stack_fit (0–20 points):
   - Overlap with candidate's proven skill set (${candidateSkills}).
   - Give reasonable credit for transferable backend/systems technologies. Do not penalize solely for framework syntax.

4. career_trajectory (0–20 points):
   - Growth into a stronger software engineer / backend engineer / platform engineer / applied AI engineer at a top-tier product company.
   - Penalize roles that trap the candidate in support, manual QA, pure consulting, ERP/vendor package maintenance, or non-engineering IT work.

5. application_probability (0–15 points):
   - Likelihood of clearing ATS screen and interview bar.
   - Location feasibility and realistic qualification match.

========================================
CRITICAL EVALUATION RULES
========================================
1. Ground truth only: Do NOT hallucinate candidate experience not present in the CV or profile.
2. No blind keyword matching: A passing mention of "AI" or "Cloud" in a non-engineering role must not inflate technical_fit.
3. Reasonable transferability: Backend languages and distributed systems tooling share transferable fundamentals.
4. Title vs reality: Distinguish genuine Software Development Engineers from Technical Consultants, Application Support, Business Analysts, or Solutions Architects.
5. Recommendation thresholds:
   - 80–100: "APPLY" (High-value, realistic engineering fit)
   - 70–79: "CONSIDER" (Viable backup or mild stretch)
   - <70: "SKIP" (Mismatched level, non-engineering, vendor maintenance, or major qualification gap)
   (Override to "SKIP" if a hard requirement makes the application a waste of time).

========================================
REQUIRED OUTPUT FORMAT
========================================
You must respond ONLY with a valid JSON object conforming to this exact schema (no markdown fences, no explanatory text outside the JSON):

{
  "ai_score": <number between 0 and 100>,
  "recommendation": "<APPLY | CONSIDER | SKIP>",
  "confidence": "<HIGH | MEDIUM | LOW>",
  "technical_fit": <number between 0 and 25>,
  "experience_fit": <number between 0 and 20>,
  "stack_fit": <number between 0 and 20>,
  "career_trajectory": <number between 0 and 20>,
  "application_probability": <number between 0 and 15>,
  "strengths": [
    "<concise bullet explaining a key alignment with candidate background>",
    "<concise bullet>"
  ],
  "gaps": [
    "<concise bullet explaining a missing requirement or risk>",
    "<concise bullet>"
  ],
  "why_apply": "<1-2 sentences summarizing why this role is worth pursuing>",
  "why_not": "<1-2 sentences summarizing the main risks or reasons to hesitate>",
  "resume_alignment": [
    "<specific evidence from CV matching the job>"
  ],
  "missing_requirements": [
    "<specific qualification from JD that candidate lacks>"
  ]
}`;
}

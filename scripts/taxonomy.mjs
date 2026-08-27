/**
 * scripts/taxonomy.mjs — Domain taxonomy, exclusions, and job classification
 */

function normalise(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const LOCATION_ALIASES = {
  "bangalore": ["bangalore", "bengaluru"],
  "bengaluru": ["bangalore", "bengaluru"],
  "delhi ncr": ["delhi", "gurgaon", "gurugram", "noida", "ncr", "new delhi"],
  "delhi": ["delhi", "gurgaon", "gurugram", "noida", "ncr", "new delhi"],
  "mumbai": ["mumbai", "navi mumbai", "thane"],
  "pune": ["pune"],
  "hyderabad": ["hyderabad"],
  "chennai": ["chennai"],
  "remote": ["remote", "work from home", "wfh", "anywhere in india", "india - remote", "remote, india", "remote - india"]
};

// ── Hard Exclusions ─────────────────────────────────────────────────────────
export const HARD_EXCLUSIONS = {
  // People Management & Product/Program Management (hard drop)
  management: /\b(manager|director|vp\b|vice president|head of|chief|cto|cpo|coo|scrum master|agile coach)\b/i,
  
  // Non-Technical / Non-Engineering Functions (hard drop)
  non_tech: /\b(sales|marketing|growth|content|video|finance|accounting|controller|equity research|portfolio specialist|hr\b|human resources|recruiter|talent|facilities|warehouse|fleet|category|cx\b|customer experience|client servicing|account executive|account manager|business development|bd\b|legal|counsel|procurement|strategist|transformation owner|solutions architect|presales|sales engineer|technical writer|package consultant|functional consultant|sap functional|oracle functional|peoplesoft|workday functional|program office|pmo\b)\b/i,

  // QA / SDET / Support (hard drop)
  qa_support: /\b(qa\b|quality assurance|sdet|test engineer|automation engineer|support engineer|customer support|technical support|it helpdesk|tech support|community engineer|devrel)\b/i,

  // DevOps / SRE / Site Reliability / DevSecOps (hard drop)
  devops_sre: /\b(devops|devsecops|sre\b|site\s+reliability)\b/i,

  // Internships / Apprenticeships / Co-ops / Trainees (hard drop)
  intern_trainee: /\b(intern|interns|internship|internships|co[\s-]?op|apprentice|apprenticeship|trainee|graduate\s+engineer\s+trainee)\b/i,

  // Hardware / Silicon / Physical Design / Chip Design / Validation / DFT (hard drop)
  hardware_silicon: /\b(silicon\s+(?:formal\s+verification|validation|design|architect|architecture|lead|engineer|tech)|hardware\s+(?:design|architect|architecture|engineer)|(?:digital|physical|chip|asic|rtl|soc|board|pcb|analog|dft)\s+design|semiconductor|fpga|vlsi|pre[\s-]?silicon|post[\s-]?silicon|formal\s+verification|silicon\s+chip|\bdft\b|design[\s-]for[\s-]test(?:ability)?)\b/i
};

export function isHardwareSiliconExclusion(title) {
  const norm = String(title || "").trim();
  if (!norm) return false;

  if (HARD_EXCLUSIONS.hardware_silicon.test(norm)) {
    const isExplicitSoftware = /\b(software\s+(?:engineer|dev\b|developer)|sde\b|backend|cloud\s+infrastructure|ai\s+platform)\b/i.test(norm);
    const isHardwareCircuitOrSilicon = /\b(silicon|digital\s+design|physical\s+design|chip\s+design|asic|fpga|vlsi|pre[\s-]?silicon|post[\s-]?silicon|formal\s+verification|hardware\s+architect|\bdft\b|design[\s-]for[\s-]test(?:ability)?)\b/i.test(norm);
    if (isExplicitSoftware && !isHardwareCircuitOrSilicon) {
      return false;
    }
    return true;
  }
  return false;
}

// ── Technical Functions ───────────────────────────────────────────────────────
export const FUNCTION_PATTERNS = {
  ai_ml: /\b(ai\b|ml\b|genai|agentic|machine learning|nlp|llm|deep learning|computer vision|data science|applied ai)\b/i,
  platform_infra: /\b(platform|infra|infrastructure|cloud|kubernetes|observability|gateway|iam|security engineer|network)\b/i,
  distributed_systems: /\b(distributed systems?|messaging|event driven|data platform|data pipeline|kafka)\b/i,
  backend: /\b(backend|server|core engineering|api\b|microservices|search)\b/i,
  fullstack: /\b(full[\s-]?stack|frontend and backend|ui\/api)\b/i,
  general_sde: /\b(software engineer|software dev|sde|systems?\s*engineer|developer|data engineer)\b/i
};

// ── Seniority Levels ─────────────────────────────────────────────────────────
export const LEVEL_PATTERNS = {
  principal: /\b(principal|distinguished|fellow)\b/i,
  staff: /\b(staff)\b/i,
  architect: /\b(architect)\b/i,
  sde_3: /\b(sde\s*iii\b|sde\s*3\b|software engineer\s*3\b|software engineer\s*iii\b|senior|sr\.?|l3\b)\b/i,
  sde_1: /\b(sde\s*i\b|sde\s*1\b|software engineer\s*1\b|software engineer\s*i\b|junior|associate|entry|l1\b|grad)\b/i
};

export function detectFunction(title, text = "") {
  for (const [fn, pattern] of Object.entries(FUNCTION_PATTERNS)) {
    if (pattern.test(title)) return fn;
  }
  // If title has generic "Engineer", "Developer", "MTS", check JD context
  if (/\b(engineer|developer|mts)\b/i.test(title)) {
    const combined = `${title} ${text.slice(0, 1500)}`;
    for (const [fn, pattern] of Object.entries(FUNCTION_PATTERNS)) {
      if (pattern.test(combined)) return fn;
    }
  }
  return null;
}

export function detectLevel(title) {
  for (const [lvl, pattern] of Object.entries(LEVEL_PATTERNS)) {
    if (pattern.test(title)) return lvl;
  }
  return "sde_2"; // default mid-level if unspecified
}

export function locationMatches(job, locations = []) {
  if (!locations.length) return true;
  const preferences = locations.map(normalise);
  const rawLoc = normalise(job.location);

  // Check if location matches any target Indian city
  const isIndiaCity = ["bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "ncr", "chennai", "india"]
    .some(c => rawLoc.includes(c));
  if (isIndiaCity) return true;

  if (job.remote) {
    if (!preferences.includes("remote")) return false;
    // Check if remote posting is restricted to non-India geos
    const nonIndiaRegions = [
      "united states", "usa", "us-", "canada", "united kingdom", "uk", "europe", "emea", 
      "latam", "australia", "poland", "germany", "ireland", "spain", "france", "netherlands", 
      "israel", "colombia", "mexico", "singapore", "denmark", "sweden", "austin", "san francisco", 
      "new york", "seattle", "chicago", "toronto", "california", "colorado", "oregon", "washington"
    ];
    const hasNonIndiaGeo = nonIndiaRegions.some(r => rawLoc.includes(r));
    const isOpenRemote = !rawLoc || rawLoc === "remote" || rawLoc.includes("worldwide") || rawLoc.includes("global") || rawLoc.includes("anywhere") || rawLoc.includes("apac");

    if (isOpenRemote) return true;
    if (hasNonIndiaGeo) return false;
    return true;
  }

  if (!rawLoc) return false;
  return preferences.some(preference => {
    if (preference === "remote") return false;
    const aliases = LOCATION_ALIASES[preference] || [preference];
    return aliases.some(alias => rawLoc.includes(alias));
  });
}

export function parseExperienceRange(value) {
  const text = String(value || "").toLowerCase();
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = text.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return { min: Number(plus[1]), max: Infinity };
  const exact = text.match(/^\d+(?:\.\d+)?$/);
  return exact ? { min: Number(text), max: Number(text) } : null;
}

export function parseExperienceRequirements(text) {
  const reqs = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/gi)) {
    reqs.push({ min: Number(m[1]), max: Number(m[2]) });
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)/gi)) {
    reqs.push({ min: Number(m[1]), max: Infinity });
  }
  if (!reqs.length) return null;
  return {
    min: Math.min(...reqs.map(r => r.min)),
    max: Math.max(...reqs.map(r => r.max))
  };
}

export function getFreshnessInfo(postedAt, maxDays = 30, now = Date.now()) {
  const posted = Date.parse(postedAt || "");
  if (!Number.isFinite(posted)) {
    return { isFresh: true, tier: "active", ageDays: 0, label: "Active (date unstated)" };
  }
  const ageDays = Math.max(0, Math.floor((now - posted) / 86_400_000));
  if (ageDays > maxDays) {
    return { isFresh: false, tier: "expired", ageDays, label: `Expired (${ageDays}d old)` };
  }
  if (ageDays <= 7) {
    return { isFresh: true, tier: "hot", ageDays, label: "🟢 Hot (0–7d)" };
  } else if (ageDays <= 14) {
    return { isFresh: true, tier: "fresh", ageDays, label: "🟡 Fresh (8–14d)" };
  } else {
    return { isFresh: true, tier: "active", ageDays, label: "⚪ Active (15–30d)" };
  }
}

export const GATES = [
  "hard_excluded_mgmt",
  "hard_excluded_nontech",
  "hard_excluded_qa",
  "hard_excluded_devops_sre",
  "hard_excluded_intern",
  "hard_excluded_hardware",
  "function_mismatch",
  "location_mismatch",
  "experience_mismatch",
  "freshness_mismatch",
  "passed_primary",
  "passed_stretch"
];

export function classifyJob(job, config = {}) {
  // 1. Hard Exclusions Check
  if (HARD_EXCLUSIONS.management.test(job.title)) return { gate: "hard_excluded_mgmt" };
  if (HARD_EXCLUSIONS.non_tech.test(job.title)) return { gate: "hard_excluded_nontech" };
  if (HARD_EXCLUSIONS.qa_support.test(job.title)) return { gate: "hard_excluded_qa" };
  if (HARD_EXCLUSIONS.devops_sre.test(job.title)) return { gate: "hard_excluded_devops_sre" };
  if (HARD_EXCLUSIONS.intern_trainee.test(job.title)) return { gate: "hard_excluded_intern" };
  if (isHardwareSiliconExclusion(job.title)) return { gate: "hard_excluded_hardware" };

  // 2. Engineering Function Detection
  const fn = detectFunction(job.title, job._experienceText || "");
  if (!fn) return { gate: "function_mismatch" };

  // 3. Location Match
  if (!locationMatches(job, config.locations)) return { gate: "location_mismatch" };

  // 4. Level & Experience Assessment
  const level = detectLevel(job.title);
  const targetExp = parseExperienceRange(config.experienceFilter) || { min: 2, max: 4 };
  const statedExp = parseExperienceRequirements(job._experienceText || "");

  let isStretch = false;

  if (["lead", "staff", "principal", "architect"].includes(level)) {
    isStretch = true;
  }

  if (statedExp) {
    if (statedExp.min > targetExp.max) {
      if (statedExp.min <= 7) {
        isStretch = true; // Stretch opportunity (e.g. 5-7 yrs)
      } else {
        return { gate: "experience_mismatch" }; // Far beyond (e.g. 8-15 yrs)
      }
    }
  }

  // 5. Freshness Tiering
  const freshness = getFreshnessInfo(job.posted_at, config.freshnessDays);
  if (!freshness.isFresh) return { gate: "freshness_mismatch" };

  return {
    gate: isStretch ? "passed_stretch" : "passed_primary",
    function: fn,
    level,
    is_stretch: isStretch,
    freshness_tier: freshness.tier,
    age_days: freshness.ageDays,
    freshness_label: freshness.label
  };
}


#!/usr/bin/env node
/**
 * scripts/ingest-discovery.mjs — Central Discovery Ingestion & Deduplication Pipeline
 * 
 * Normalizes discovery records from data/discovery_results.json, enforces official ATS
 * precedence, executes shared taxonomy and deterministic scoring, and merges atomically
 * into data/scan_results.json.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DISCOVERY_FILE = path.join(ROOT, "data/discovery_results.json");
const SCAN_RESULTS_FILE = path.join(ROOT, "data/scan_results.json");
const CACHE_FILE = path.join(ROOT, "data/.ai_cache.json");

export function readConfig() {
  const p = path.join(ROOT, "config/profile.yml");
  if (!fs.existsSync(p)) return { roles: [], locations: [], experienceFilter: "2-4", freshnessDays: 30 };
  const profile = yaml.load(fs.readFileSync(p, "utf8")) || {};
  const candidate = profile.candidate || {};
  const search = profile.search || {};
  return {
    roles: Array.isArray(candidate.target_roles) ? candidate.target_roles.filter(Boolean) : [],
    locations: Array.isArray(candidate.locations) ? candidate.locations.filter(Boolean) : [],
    experienceFilter: String(search.experience_filter || "2-4").trim(),
    freshnessDays: Number(search.freshness_days) || 30,
  };
}

export function readPortals() {
  const p = path.join(ROOT, "portals/india.yml");
  if (!fs.existsSync(p)) return {};
  return yaml.load(fs.readFileSync(p, "utf8")) || {};
}

export function normalise(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LOCATION_ALIASES = {
  "bangalore": ["bangalore", "bengaluru"],
  "bengaluru": ["bangalore", "bengaluru"],
  "delhi ncr": ["delhi", "gurgaon", "gurugram", "noida", "ncr", "new delhi"],
  "delhi": ["delhi", "gurgaon", "gurugram", "noida", "ncr", "new delhi"],
  "mumbai": ["mumbai", "navi mumbai", "thane"],
  "hyderabad": ["hyderabad", "secunderabad"],
  "pune": ["pune", "hinjewadi"],
  "chennai": ["chennai"],
  "remote": ["remote", "work from home", "anywhere", "virtual", "india"]
};

export const ROLE_FAMILY_PATTERNS = [
  // 1. Non-Technical / Management / Product / Program / Writing (Hard Exclusions)
  {
    family: "non_technical",
    pattern: /\b(technical writer|writer|documentation|product owner|product manager|technical product manager|program manager|technical program manager|tpm\b|project manager|scrum master|agile coach|sales|marketing|growth|content|video|finance|accounting|controller|equity research|portfolio specialist|hr\b|human resources|recruiter|talent|facilities|warehouse|fleet|category|cx\b|customer experience|client servicing|account executive|account manager|business development|bd\b|legal|counsel|procurement|strategist|transformation owner|bdr\b|executive assistant|advisory|risk analytics|rcsa|strategy)\b/i
  },
  // 2. QA / SDET / IT Helpdesk
  {
    family: "qa_sdet",
    pattern: /\b(qa\b|quality assurance|sdet|test engineer|software engineer in test|automation test|test automation|it helpdesk|tech support)\b/i
  },
  // 3. Consulting / Solutions / Customer Success
  {
    family: "consulting_solutions",
    pattern: /\b(consultant|technical consultant|solutions consultant|implementation consultant|solutions architect|presales|sales engineer|customer success engineer|customer engineer|technical solutions engineer)\b/i
  },
  // 4. BI & Analytics
  {
    family: "data_engineering",
    pattern: /\b(business intelligence engineer|bi engineer|bie\b|bi developer|tableau developer|power bi|looker developer)\b/i
  },
  // 5. Application Support / RPA
  {
    family: "application_support",
    pattern: /\b(application engineer|support engineer|customer engineer|tech support engineer|field engineer|implementation engineer|production support|rpa engineer|uipath|robotic process automation)\b/i
  },
  // 6. Specialized Engineering
  {
    family: "ai_ml",
    pattern: /\b(machine learning|ml engineer|ai engineer|ai agent|applied ai|nlp engineer|llm engineer|deep learning|computer vision|genai|agentic ai)\b/i
  },
  {
    family: "data_science",
    pattern: /\b(data scientist|decision scientist|applied scientist|quantitative researcher|statistician)\b/i
  },
  {
    family: "data_engineering",
    pattern: /\b(data engineer|big data engineer|data platform engineer|etl engineer|analytics engineer|data pipeline|database engineer)\b/i
  },
  {
    family: "security",
    pattern: /\b(security engineer|appsec|application security|cloud security|infosec|information security|product security|security operations|incident response|soc analyst|iam engineer|threat|vulnerability|compliance & security)\b/i
  },
  {
    family: "distributed_systems",
    pattern: /\b(distributed systems?|messaging platform|event driven|kafka|stream processing|consensus)\b/i
  },
  {
    family: "backend",
    pattern: /\b(backend|back[- ]?end|server[- ]?side|api engineer|microservices)\b/i
  },
  {
    family: "platform_infra",
    pattern: /\b(platform engineer|infrastructure engineer|infra engineer|cloud engineer|sre\b|site reliability|devops|kubernetes|observability|cloud network|systems engineer|system development engineer|sysde|platform)\b/i
  },
  {
    family: "fullstack",
    pattern: /\b(full[\s-]?stack|frontend and backend|ui\/api|fullstack)\b/i
  },
  {
    family: "frontend",
    pattern: /\b(frontend|front[- ]?end|ui engineer|web developer|react developer|angular developer)\b/i
  },
  {
    family: "mobile",
    pattern: /\b(android|ios\b|react[\s-]?native|flutter|mobile development|mobile engineer|mobile developer|\bmobile\s+(?:app|application|client|frontend|software|sde|engineer|dev\b|developer)\b|\([^)]*mobile[^)]*\)|[-–—,:]\s*mobile\b|\bmobile\b)/i
  },
  {
    family: "general_sde",
    pattern: /\b(software development engineer|software engineer|sde\b|software dev|developer|mts\b|member of technical staff)\b/i
  }
];

export const SENIORITY_PATTERNS = [
  { seniority: "manager", pattern: /\b(manager|engineering manager|sdm\b|software development manager|director|vp\b|vice president|head of|chief|cto)\b/i },
  { seniority: "principal", pattern: /\b(principal|distinguished|fellow)\b/i },
  { seniority: "staff", pattern: /\b(staff)\b/i },
  { seniority: "lead", pattern: /\b(lead|tech lead|team lead|architect)\b/i },
  { seniority: "senior", pattern: /\b(senior|sr\.?)\b/i },
  { seniority: "sde_3", pattern: /\b(sde\s*iii\b|sde\s*3\b|software engineer\s*3\b|software engineer\s*iii\b|engineer\s*iii\b|engineer\s*3\b|mts\s*3\b|l3\b)\b/i },
  { seniority: "sde_2", pattern: /\b(sde\s*ii\b|sde\s*2\b|software engineer\s*2\b|software engineer\s*ii\b|engineer\s*ii\b|engineer\s*2\b|intermediate|l2\b|mid)\b/i },
  { seniority: "sde_1", pattern: /\b(sde\s*i\b|sde\s*1\b|software engineer\s*1\b|software engineer\s*i\b|engineer\s*i\b|engineer\s*1\b|junior|associate|entry|l1\b|grad|graduate)\b/i },
  { seniority: "intern", pattern: /\b(intern|internship|co-op|apprentice|apprenticeship|trainee)\b/i }
];

export function detectRoleFamily(title, department = "", text = "") {
  const normTitle = String(title || "").trim();
  for (const { family, pattern } of ROLE_FAMILY_PATTERNS) {
    if (pattern.test(normTitle)) return family;
  }
  const normDept = String(department || "").trim();
  if (normDept) {
    for (const { family, pattern } of ROLE_FAMILY_PATTERNS) {
      if (pattern.test(normDept)) return family;
    }
  }
  if (/\b(engineer|developer|mts|tech|member technical staff)\b/i.test(normTitle)) {
    const contextualSnippet = `${normTitle} ${normDept} ${text.slice(0, 1000)}`;
    for (const { family, pattern } of ROLE_FAMILY_PATTERNS) {
      if (["non_technical", "qa_sdet", "consulting_solutions", "application_support"].includes(family)) continue;
      if (family === "ai_ml") {
        if (/\b(machine learning|deep learning|llm|nlp|agentic|genai)\b/i.test(contextualSnippet)) return "ai_ml";
      } else if (pattern.test(contextualSnippet)) {
        return family;
      }
    }
    return "general_sde";
  }
  return "unknown";
}

export function detectJobSeniority(title) {
  const normTitle = String(title || "").trim();
  for (const { seniority, pattern } of SENIORITY_PATTERNS) {
    if (pattern.test(normTitle)) return seniority;
  }
  return "unknown";
}

export function detectCareerAlignment(roleFamily, title = "") {
  const normTitle = String(title || "").toLowerCase();
  if (/\b(business intelligence|bi engineer|bie\b|bi developer|tableau|looker)\b/i.test(normTitle)) {
    return "low";
  }
  if (["backend", "distributed_systems", "platform_infra", "ai_ml", "fullstack"].includes(roleFamily)) {
    return "very_high";
  }
  if (roleFamily === "general_sde") {
    return "high";
  }
  if (["data_engineering", "security"].includes(roleFamily)) {
    return "medium";
  }
  return "low";
}

export function locationMatches(job, locations) {
  if (!locations || !locations.length) return true;
  const preferences = locations.map(normalise);
  const rawLoc = normalise(job.location);

  const isIndiaCity = ["bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "ncr", "chennai", "india"]
    .some(c => rawLoc.includes(c));
  if (isIndiaCity) return true;

  if (job.remote) return true;
  if (!rawLoc) return false;

  return preferences.some(preference => {
    const aliases = LOCATION_ALIASES[preference] || [preference];
    return aliases.some(alias => rawLoc.includes(alias));
  });
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
    return { isFresh: true, tier: "active", ageDays: 0, confidence: "unknown", label: "Active (date unstated)" };
  }
  const ageDays = Math.max(0, Math.floor((now - posted) / 86_400_000));
  if (ageDays > maxDays) {
    return { isFresh: false, tier: "expired", ageDays, confidence: "high", label: `Expired (${ageDays}d old)` };
  }
  if (ageDays <= 7) {
    return { isFresh: true, tier: "hot", ageDays, confidence: "high", label: "🟢 Hot (0–7d)" };
  } else if (ageDays <= 14) {
    return { isFresh: true, tier: "fresh", ageDays, confidence: "high", label: "🟡 Fresh (8–14d)" };
  } else {
    return { isFresh: true, tier: "active", ageDays, confidence: "high", label: "⚪ Active (15–30d)" };
  }
}

/**
 * Deterministic detection for obvious staffing/consultancy signals
 */
export function detectDiscoveryRisk(company, title = "", snippet = "", portalsLookup = null) {
  const comp = String(company || "").trim();
  const normComp = normalise(comp);

  // If the company is registered in portals/india.yml (known direct employer), not a staffing risk
  if (portalsLookup && portalsLookup.has(normComp)) {
    return "normal";
  }

  // Obvious staffing / manpower / recruitment / consultancy patterns in company name
  const STAFFING_PATTERNS = [
    /\b(consulting|consultancy|staffing|recruitment|recruiting|placement|manpower|headhunter|talent acquisition|talent search|talent solutions|hr solutions|hr services|resources solutions|\bhr\b|human resources)\b/i
  ];

  for (const pattern of STAFFING_PATTERNS) {
    if (pattern.test(comp)) {
      return "staffing_agency_risk";
    }
  }

  if (/\b(leading client|confidential|hiring client|fortune 500 client|client of)\b/i.test(comp)) {
    return "staffing_agency_risk";
  }

  return "normal";
}

export function classifyJob(job, config) {
  const roleFamily = detectRoleFamily(job.title, job.department || "", job._experienceText || "");
  const jobSeniority = detectJobSeniority(job.title);
  const careerAlignment = detectCareerAlignment(roleFamily, job.title);

  // Hard exclusions
  if (["non_technical", "qa_sdet", "consulting_solutions", "application_support"].includes(roleFamily)) {
    return { gate: "hard_excluded", role_family: roleFamily, job_seniority: jobSeniority, career_alignment: careerAlignment };
  }

  // Location filter
  if (!locationMatches(job, config.locations)) {
    return { gate: "location_mismatch", role_family: roleFamily, job_seniority: jobSeniority, career_alignment: careerAlignment };
  }

  // Experience fit
  let experienceFit = "primary";
  let isStretch = false;

  if (["manager", "principal", "director"].includes(jobSeniority)) {
    return { gate: "seniority_mismatch", role_family: roleFamily, job_seniority: jobSeniority, career_alignment: careerAlignment };
  }

  if (["staff", "lead"].includes(jobSeniority)) {
    experienceFit = "stretch";
    isStretch = true;
  }

  const statedExp = parseExperienceRequirements(job._experienceText || "");
  if (statedExp) {
    if (statedExp.min > 4) {
      if (statedExp.min <= 7) {
        experienceFit = "stretch";
        isStretch = true;
      } else {
        return { gate: "experience_mismatch", role_family: roleFamily, job_seniority: jobSeniority, career_alignment: careerAlignment };
      }
    }
  }

  const freshness = getFreshnessInfo(job.posted_at, config.freshnessDays);
  if (!freshness.isFresh) {
    return { gate: "freshness_mismatch", role_family: roleFamily, job_seniority: jobSeniority, career_alignment: careerAlignment };
  }

  return {
    gate: isStretch ? "passed_stretch" : "passed_primary",
    role_family: roleFamily,
    job_seniority: jobSeniority,
    experience_fit: experienceFit,
    career_alignment: careerAlignment,
    is_stretch: isStretch,
    freshness_tier: freshness.tier,
    freshness_confidence: freshness.confidence,
    age_days: freshness.ageDays,
    freshness_label: freshness.label
  };
}

export function computeJobScore(job, classification, config) {
  let score = 50;
  const reasons = [];

  // Priority / Tier
  const priority = job.priority || "GOOD";
  if (priority === "GO") {
    score += 25;
    reasons.push("GO company priority (Target Dream Employer)");
  } else {
    score += 15;
    reasons.push("Strong product/tech employer");
  }

  // Alignment
  if (classification.career_alignment === "very_high") {
    score += 15;
    reasons.push(`Very high target domain: ${classification.role_family.replace(/_/g, " ")}`);
  } else if (classification.career_alignment === "high") {
    score += 10;
    reasons.push("Core software engineering (SDE)");
  } else if (classification.career_alignment === "medium") {
    score += 5;
    reasons.push(`Secondary engineering domain: ${classification.role_family.replace(/_/g, " ")}`);
  }

  // Experience Fit
  if (classification.experience_fit === "primary") {
    score += 10;
    reasons.push("Primary experience fit (Sweet-spot 2–4 YOE)");
  } else if (classification.experience_fit === "stretch") {
    score += 4;
    reasons.push("High-upside stretch role (5–7 YOE / Senior)");
  }

  // Freshness (Only award bonus if valid date was provided)
  if (job.posted_at && classification.freshness_confidence !== "unknown") {
    if (classification.freshness_tier === "hot") {
      score += 5;
      reasons.push("Hot posting (0–7 days old)");
    } else if (classification.freshness_tier === "fresh") {
      score += 2;
      reasons.push("Fresh posting (8–14 days old)");
    }
  }

  return { score: Math.min(100, score), reasons };
}

export function buildCompanyLookup(portals) {
  const lookup = new Map();
  for (const [board, list] of Object.entries(portals)) {
    if (Array.isArray(list)) {
      list.forEach(c => {
        const name = typeof c === "string" ? c : c.name;
        const tier = typeof c === "object" && c.tier ? String(c.tier) : "1";
        const priority = typeof c === "object" && c.priority ? c.priority : "GOOD";
        const norm = normalise(name);
        lookup.set(norm, { name, tier, priority, board });
      });
    }
  }
  return lookup;
}

export function resolveCompany(rawCompany, companyLookup) {
  const norm = normalise(rawCompany);
  if (!norm) return { name: "Unknown", tier: "2", priority: "GOOD", board: "aggregator" };

  if (companyLookup.has(norm)) {
    return companyLookup.get(norm);
  }

  for (const [key, val] of companyLookup.entries()) {
    if (norm.includes(key) || key.includes(norm)) {
      return val;
    }
  }

  return { name: rawCompany.trim(), tier: "2", priority: "GOOD", board: "aggregator" };
}

export function normaliseJobTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\b(sde\s*ii|sde\s*2|software dev(?:eloper|elopment)? engineer\s*ii|software dev(?:eloper|elopment)? engineer\s*2|engineer\s*ii|engineer\s*2)\b/gi, "sde_2")
    .replace(/\b(sde\s*i|sde\s*1|software dev(?:eloper|elopment)? engineer\s*i|software dev(?:eloper|elopment)? engineer\s*1|engineer\s*i|engineer\s*1)\b/gi, "sde_1")
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

export function computeDedupKey(company, title) {
  return `${normalise(company)}|${normaliseJobTitle(title)}`;
}

export function validateDiscoveryRecord(raw) {
  if (!raw || typeof raw !== "object") return { valid: false, reason: "Not an object" };
  const title = String(raw.title || "").trim();
  const company = String(raw.company || "").trim();
  const url = String(raw.url || "").trim();

  if (!title || title.length < 2) return { valid: false, reason: "Missing or invalid title" };
  if (!company || company.length < 1) return { valid: false, reason: "Missing or invalid company" };
  if (!url || !url.startsWith("http")) return { valid: false, reason: "Missing or invalid URL" };

  return { valid: true };
}

export function ingestDiscovery(options = {}) {
  const discoveryPath = options.discoveryPath || DISCOVERY_FILE;
  const scanResultsPath = options.scanResultsPath || SCAN_RESULTS_FILE;
  const cachePath = options.cachePath || CACHE_FILE;

  if (!fs.existsSync(discoveryPath)) {
    console.log(`ℹ️  No discovery file found at ${path.relative(ROOT, discoveryPath)}.`);
    return { success: true, count: 0, added: 0, duplicatesDropped: 0 };
  }

  let discoveryData;
  try {
    discoveryData = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
  } catch (err) {
    console.error(`❌ Failed to parse discovery file: ${err.message}`);
    return { success: false, error: err.message };
  }

  const rawJobs = Array.isArray(discoveryData) ? discoveryData : (discoveryData.jobs || []);
  if (rawJobs.length === 0) {
    console.log("ℹ️  Discovery results file contains 0 jobs.");
    return { success: true, count: 0, added: 0, duplicatesDropped: 0 };
  }

  let baselineData = { jobs: [] };
  if (fs.existsSync(scanResultsPath)) {
    try {
      baselineData = JSON.parse(fs.readFileSync(scanResultsPath, "utf8"));
    } catch {
      baselineData = { jobs: [] };
    }
  }

  const existingScanJobs = baselineData.jobs || [];
  const config = options.config || readConfig();
  const portals = options.portals || readPortals();
  const companyLookup = buildCompanyLookup(portals);

  const atsKeys = new Set();
  const existingJobMap = new Map();

  for (const j of existingScanJobs) {
    const key = computeDedupKey(j.company, j.title);
    existingJobMap.set(key, j);
    const srcType = j.source_type || (j.source && j.source !== "naukri" && j.source !== "smart_scraper" ? "employer_ats" : "aggregator");
    if (srcType === "employer_ats" || (j.source && !["naukri", "smart_scraper", "discovery"].includes(j.source))) {
      atsKeys.add(key);
    }
  }

  let rejectedCount = 0;
  let atsDuplicatesDropped = 0;
  let discoveryCollapsed = 0;
  let gateFilteredCount = 0;
  const acceptedJobs = [];
  const seenDiscoveryKeys = new Set();

  for (const raw of rawJobs) {
    const validation = validateDiscoveryRecord(raw);
    if (!validation.valid) {
      rejectedCount++;
      continue;
    }

    const coInfo = resolveCompany(raw.company, companyLookup);
    const dedupKey = computeDedupKey(coInfo.name, raw.title);

    // Rule 1: Official Employer ATS always beats Aggregator
    if (atsKeys.has(dedupKey)) {
      atsDuplicatesDropped++;
      continue;
    }

    // Rule 2: Collapse duplicates within discovery batch
    if (seenDiscoveryKeys.has(dedupKey)) {
      discoveryCollapsed++;
      continue;
    }
    seenDiscoveryKeys.add(dedupKey);

    const discoveryRisk = detectDiscoveryRisk(coInfo.name, raw.title, raw.snippet, companyLookup);

    // Build Canonical-compatible job representation
    const canonicalDiscoveryJob = {
      source: raw.source || "discovery",
      source_type: raw.source_type || "aggregator",
      discovery_risk: discoveryRisk,
      company: coInfo.name,
      tier: coInfo.tier || "2",
      priority: raw.priority || coInfo.priority || "GOOD",
      title: String(raw.title).trim(),
      location: raw.location ? String(raw.location).trim() : "India",
      url: String(raw.url).trim(),
      apply_url: raw.apply_url ? String(raw.apply_url).trim() : null,
      posted_at: raw.posted_at || null,
      snippet: raw.snippet ? String(raw.snippet).slice(0, 500) : null,
      salary: raw.salary || null,
      experience: raw.experience || null,
      source_job_id: raw.source_job_id || null,
      source_url: raw.source_url || raw.url,
      remote: Boolean(raw.remote || (raw.location && String(raw.location).toLowerCase().includes("remote"))),
      department: raw.department || "Engineering",
      _experienceText: `${raw.title} ${raw.snippet || ""} ${raw.experience || ""}`
    };

    // Run shared taxonomy & gate classification
    const res = classifyJob(canonicalDiscoveryJob, config);
    if (res.gate !== "passed_primary" && res.gate !== "passed_stretch") {
      gateFilteredCount++;
      continue;
    }

    // Run shared deterministic scoring
    const scoring = computeJobScore(canonicalDiscoveryJob, res, config);
    const { _experienceText, ...cleanJob } = canonicalDiscoveryJob;

    const enrichedDiscoveryJob = {
      ...cleanJob,
      role_family: res.role_family,
      job_seniority: res.job_seniority,
      experience_fit: res.experience_fit,
      career_alignment: res.career_alignment,
      seniority: res.job_seniority,
      fit: res.experience_fit,
      function: res.role_family,
      level: res.job_seniority,
      is_stretch: res.is_stretch,
      freshness_tier: res.freshness_tier,
      freshness_confidence: res.freshness_confidence || (raw.posted_at ? "high" : "unknown"),
      age_days: res.age_days,
      score: scoring.score,
      score_reasons: scoring.reasons
    };

    acceptedJobs.push(enrichedDiscoveryJob);
  }

  // Load and re-attach AI cache if present
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      acceptedJobs.forEach(job => {
        if (job.url && cache[job.url]) {
          job.ai_evaluation = cache[job.url];
        }
      });
    } catch {}
  }

  // Merge with existing scan results
  const finalJobList = [...existingScanJobs.filter(j => {
    const key = computeDedupKey(j.company, j.title);
    return !seenDiscoveryKeys.has(key);
  }), ...acceptedJobs];

  // Re-sort: Deterministic Score descending > Age ascending
  finalJobList.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }
    return (a.age_days || 0) - (b.age_days || 0);
  });

  // Atomic write to data/scan_results.json
  const out = {
    scanned_at: baselineData.scanned_at || new Date().toISOString(),
    ingested_discovery_at: new Date().toISOString(),
    total: finalJobList.length,
    errors: baselineData.errors || 0,
    jobs: finalJobList
  };

  const tempFile = scanResultsPath + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(out, null, 2), "utf8");
  fs.renameSync(tempFile, scanResultsPath);

  if (!options.silent) {
    console.log(`\n${"═".repeat(65)}`);
    console.log(`📥 DISCOVERY INGESTION REPORT`);
    console.log(`${"═".repeat(65)}`);
    console.log(`• Raw discovery records evaluated:  ${rawJobs.length}`);
    console.log(`• Invalid records rejected:         ${rejectedCount}`);
    console.log(`• Official ATS duplicates dropped:  ${atsDuplicatesDropped} (ATS precedence preserved)`);
    console.log(`• Duplicate discovery collapsed:    ${discoveryCollapsed}`);
    console.log(`• Filtered by role/exp/loc gates:   ${gateFilteredCount}`);
    console.log(`• Accepted & scored discovery jobs: ${acceptedJobs.length}`);
    console.log(`• Total jobs in scan_results.json:  ${finalJobList.length} (was ${existingScanJobs.length})`);
    console.log(`${"═".repeat(65)}\n`);
  }

  return {
    success: true,
    totalEvaluated: rawJobs.length,
    rejectedCount,
    atsDuplicatesDropped,
    discoveryCollapsed,
    gateFilteredCount,
    acceptedCount: acceptedJobs.length,
    initialCount: existingScanJobs.length,
    finalCount: finalJobList.length
  };
}

if (process.argv[1] && (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) || process.argv[1].endsWith("ingest-discovery.mjs"))) {
  ingestDiscovery();
}

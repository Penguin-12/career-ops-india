#!/usr/bin/env node
/**
 * scripts/scan.mjs — career-ops-india portal scanner
 * 
 * Multi-dimensional role classifier and tiered freshness engine.
 * Zero LLM tokens. Zero scraping. Clean JSON responses.
 * 
 * Run:  npm run scan
 * Run:  node scripts/scan.mjs --board greenhouse
 * Run:  node scripts/scan.mjs --json    (raw JSON output)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import adapters from "./adapters/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ── Profile config ───────────────────────────────────────────────────────────
function readConfig() {
  const p = path.join(ROOT, "config/profile.yml");
  if (!fs.existsSync(p)) {
    console.error("❌ config/profile.yml not found. Run: npm run doctor");
    process.exit(1);
  }
  const profile = yaml.load(fs.readFileSync(p, "utf8")) || {};
  const candidate = profile.candidate || {};
  const search = profile.search || {};
  return {
    roles: Array.isArray(candidate.target_roles) ? candidate.target_roles.filter(Boolean) : [],
    locations: Array.isArray(candidate.locations) ? candidate.locations.filter(Boolean) : [],
    experienceFilter: String(search.experience_filter || "").trim(),
    freshnessDays: Number(search.freshness_days) || 30,
    boards: search.boards || {},
  };
}

// ── Portals loader ────────────────────────────────────────────────────────────
function readPortals() {
  const p = path.join(ROOT, "portals/india.yml");
  return yaml.load(fs.readFileSync(p, "utf8")) || {};
}

function normalise(str) {
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
  "pune": ["pune"],
  "hyderabad": ["hyderabad"],
  "chennai": ["chennai"],
  "remote": ["remote", "work from home", "wfh", "anywhere in india", "india - remote", "remote, india", "remote - india"]
};

// ── Hard Exclusions ─────────────────────────────────────────────────────────
const HARD_EXCLUSIONS = {
  // People Management & Product/Program Management (hard drop)
  management: /\b(manager|director|vp\b|vice president|head of|chief|cto|cpo|coo|scrum master|agile coach)\b/i,
  
  // Non-Technical / Non-Engineering Functions (hard drop)
  non_tech: /\b(sales|marketing|growth|content|video|finance|accounting|controller|equity research|portfolio specialist|hr\b|human resources|recruiter|talent|facilities|warehouse|fleet|category|cx\b|customer experience|client servicing|account executive|account manager|business development|bd\b|legal|counsel|procurement|strategist|transformation owner|solutions architect|presales|sales engineer|technical writer)\b/i,
  
  // QA / SDET / Support (hard drop)
  qa_support: /\b(qa\b|quality assurance|sdet|test engineer|automation engineer|support engineer|customer support|technical support|it helpdesk|tech support|community engineer|devrel)\b/i,

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
const FUNCTION_PATTERNS = {
  ai_ml: /\b(ai\b|ml\b|genai|agentic|machine learning|nlp|llm|deep learning|computer vision|data science|applied ai)\b/i,
  platform_infra: /\b(platform|infra|infrastructure|cloud|kubernetes|observability|devops|sre|gateway|iam|security engineer|network)\b/i,
  distributed_systems: /\b(distributed systems?|messaging|event driven|data platform|data pipeline|kafka)\b/i,
  backend: /\b(backend|server|core engineering|api\b|microservices|search)\b/i,
  fullstack: /\b(full[\s-]?stack|frontend and backend|ui\/api)\b/i,
  general_sde: /\b(software engineer|software dev|sde|systems?\s*engineer|developer|data engineer)\b/i
};

// ── Seniority Levels ─────────────────────────────────────────────────────────
const LEVEL_PATTERNS = {
  principal: /\b(principal)\b/i,
  staff: /\b(staff)\b/i,
  lead: /\b(lead|tech lead)\b/i,
  architect: /\b(architect)\b/i,
  sde_3: /\b(sde\s*iii\b|sde\s*3\b|software engineer\s*3\b|software engineer\s*iii\b|senior|sr\.?|l3\b)\b/i,
  sde_2: /\b(sde\s*ii\b|sde\s*2\b|software engineer\s*2\b|software engineer\s*ii\b|intermediate|l2\b|mid)\b/i,
  sde_1: /\b(sde\s*i\b|sde\s*1\b|software engineer\s*1\b|software engineer\s*i\b|junior|associate|entry|l1\b|grad)\b/i
};

function detectFunction(title, text = "") {
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

function detectLevel(title) {
  for (const [lvl, pattern] of Object.entries(LEVEL_PATTERNS)) {
    if (pattern.test(title)) return lvl;
  }
  return "sde_2"; // default mid-level if unspecified
}

function locationMatches(job, locations) {
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

function parseExperienceRange(value) {
  const text = String(value || "").toLowerCase();
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = text.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return { min: Number(plus[1]), max: Infinity };
  const exact = text.match(/^\d+(?:\.\d+)?$/);
  return exact ? { min: Number(text), max: Number(text) } : null;
}

function parseExperienceRequirements(text) {
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

function getFreshnessInfo(postedAt, maxDays = 30, now = Date.now()) {
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

const GATES = [
  "hard_excluded_mgmt",
  "hard_excluded_nontech",
  "hard_excluded_qa",
  "hard_excluded_hardware",
  "function_mismatch",
  "location_mismatch",
  "experience_mismatch",
  "freshness_mismatch",
  "passed_primary",
  "passed_stretch"
];

const stats = {
  total: 0,
  byGate: Object.fromEntries(GATES.map(g => [g, { count: 0, samples: [] }])),
  bySource: {}
};

function classifyJob(job, config) {
  // 1. Hard Exclusions Check
  if (HARD_EXCLUSIONS.management.test(job.title)) return { gate: "hard_excluded_mgmt" };
  if (HARD_EXCLUSIONS.non_tech.test(job.title)) return { gate: "hard_excluded_nontech" };
  if (HARD_EXCLUSIONS.qa_support.test(job.title)) return { gate: "hard_excluded_qa" };
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

// ── Main Exported Runner ──────────────────────────────────────────────────────
export async function runScan(options = {}) {
  const args = options.args || process.argv.slice(2);
  const boardFilter = options.board || args.find(a => a.startsWith("--board="))?.split("=")[1];
  const debugMode = options.debug || args.includes("--debug") || args.includes("-d") || args.includes("--verbose") || args.includes("-v");
  const jsonMode = options.json || args.includes("--json");
  const silent = options.silent || false;

  const config = options.config || readConfig();
  const portals = options.portals || readPortals();
  const results = [], errors = [];
  let totalFetchedJobs = 0;
  const totalCompanies = Object.values(portals).reduce((acc, val) => acc + (Array.isArray(val) ? val.length : 0), 0);

  if (!jsonMode && !silent) {
    console.log(`\n🔍 career-ops-india scanner`);
    console.log(`   Locations: ${config.locations.join(", ")}  |  Max Age: ${config.freshnessDays} days`);
    console.log(`   Companies: ${totalCompanies}\n`);
  }

  async function scanBoard(name, companies, fetcher, normalizer) {
    if (config.boards[name] === false) return;
    if (boardFilter && boardFilter !== name) return;
    if (!jsonMode && !debugMode && !silent) process.stdout.write(`Scanning ${companies.length} ${name} companies...`);
    if (debugMode && !silent) console.log(`\n── Scanning ${name.toUpperCase()} (${companies.length} companies) ──`);
    
    stats.bySource[name] = stats.bySource[name] || { total: 0, byGate: Object.fromEntries(GATES.map(g => [g, 0])) };

    const tasks = companies.map(async co => {
      if (co.note?.includes("current employer")) {
        if (debugMode && !silent) console.log(`  [${name}] ${co.name}: ⏭️  Skipped (current employer note)`);
        return;
      }
      const { jobs, err } = await fetcher(co.slug || co);
      if (err) {
        errors.push({ company: co.name, board: name, error: err });
        if (debugMode && !silent) console.log(`  [${name}] ${co.name} (${co.slug || co.tenant || ""}): ⚠️  ${err}`);
        return;
      }
      totalFetchedJobs += jobs.length;
      const normalizedList = jobs.map(j => normalizer(j, co));
      const matched = [];

      for (const j of normalizedList) {
        stats.total++;
        const res = classifyJob(j, config);
        const gate = res.gate;
        stats.byGate[gate].count++;
        if (stats.byGate[gate].samples.length < 25) {
          stats.byGate[gate].samples.push({ company: j.company, title: j.title, location: j.location, board: name, tier: j.tier });
        }
        stats.bySource[name].total++;
        stats.bySource[name].byGate[gate]++;

        if (gate === "passed_primary" || gate === "passed_stretch") {
          const { _experienceText, ...cleanJob } = j;
          const enrichedJob = {
            ...cleanJob,
            priority: j.priority || co.priority || "GOOD",
            function: res.function,
            level: res.level,
            is_stretch: res.is_stretch,
            freshness_tier: res.freshness_tier,
            age_days: res.age_days
          };
          matched.push(enrichedJob);
        }
      }

      if (debugMode && !silent) {
        console.log(`  [${name}] ${co.name}: ✅ ${jobs.length} postings found | 🎯 ${matched.length} matched`);
        if (matched.length > 0) {
          matched.forEach(m => console.log(`      ↳ Matched [${m.level}${m.is_stretch ? " (stretch)" : ""}]: "${m.title}" (${m.location})`));
        }
      } else if (matched.length && !jsonMode && !silent) {
        process.stdout.write(` ${co.name}(${matched.length})`);
      }
      results.push(...matched);
    });
    await Promise.allSettled(tasks);
    if (!jsonMode && !debugMode && !silent) console.log(" ✓");
  }

  for (const [id, adapter] of Object.entries(adapters)) {
    if (portals[id] && portals[id].length > 0) {
      await scanBoard(id, portals[id], adapter.fetchJobs, adapter.normalize);
    }
  }

  // Dedup by title+company
  const seen = new Set();
  const unique = results.filter(j => {
    const key = `${j.title.toLowerCase().trim()}|${j.company.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  // Re-attach existing cached AI evaluations if present
  const dataDir = path.join(ROOT, "data");
  const cachePath = path.join(dataDir, ".ai_cache.json");
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      unique.forEach(j => {
        if (j.url && cache[j.url]) {
          j.ai_evaluation = cache[j.url];
        }
      });
    } catch {}
  }

  // Sort: Tier 1 Primary (Hot > Fresh > Active) > Tier 1 Stretch > Tier 2 Primary > Tier 2 Stretch
  const freshnessRank = { hot: 0, fresh: 1, active: 2, expired: 3 };
  unique.sort((a, b) => {
    const aTier = a.tier === "0" ? 0 : (a.tier === "1" ? 1 : 2);
    const bTier = b.tier === "0" ? 0 : (b.tier === "1" ? 1 : 2);
    if (aTier !== bTier) return aTier - bTier;

    const aStretch = a.is_stretch ? 1 : 0;
    const bStretch = b.is_stretch ? 1 : 0;
    if (aStretch !== bStretch) return aStretch - bStretch;

    const aFresh = freshnessRank[a.freshness_tier] ?? 2;
    const bFresh = freshnessRank[b.freshness_tier] ?? 2;
    if (aFresh !== bFresh) return aFresh - bFresh;

    return (a.age_days || 0) - (b.age_days || 0);
  });

  // Save
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = options.outputPath || path.join(dataDir, "scan_results.json");
  const out = { scanned_at: new Date().toISOString(), total: unique.length,
                errors: errors.length, jobs: unique };
  
  const tempFile = `${outputPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(out, null, 2));
  fs.renameSync(tempFile, outputPath);

  if (jsonMode && !silent) { console.log(JSON.stringify(out)); }

  if (!silent && !jsonMode) {
    // ── Rejection Funnel Diagnostic Report ────────────────────────────────────────
    console.log(`\n${"═".repeat(65)}`);
    console.log(`📊 FILTERING FUNNEL & CLASSIFICATION REPORT`);
    console.log(`${"═".repeat(65)}`);
    console.log(`Total Postings Evaluated: ${stats.total}\n`);

    const gateLabels = {
      hard_excluded_mgmt: "1. Hard Exclusion: People Management (Manager/Dir/VP/Chief)",
      hard_excluded_nontech: "2. Hard Exclusion: Non-Tech (Sales/Mktg/HR/Finance/Ops/Content)",
      hard_excluded_qa: "3. Hard Exclusion: QA/SDET/IT Helpdesk/Tech Support",
      hard_excluded_hardware: "4. Hard Exclusion: Hardware / Silicon / Verification / Physical Design",
      function_mismatch: "5. Function Mismatch: No Backend/Platform/AI/SDE signal",
      location_mismatch: "6. Location Mismatch: Outside Target India Hubs / Non-Remote",
      experience_mismatch: "7. Experience Mismatch: Requirements far exceed profile (>7 yrs)",
      freshness_mismatch: "8. Stale / Expired (> 30 days old)",
      passed_primary: "9. Passed: Primary Match (IC SDE I / II / III within 2-4 yrs)",
      passed_stretch: "10. Passed: Stretch Match (Lead / Staff / Principal / 5-7 yrs)"
    };

    console.log(`── Step-by-Step Gate Breakdown ──`);
    for (const gate of GATES) {
      const g = stats.byGate[gate];
      const pct = stats.total > 0 ? ((g.count / stats.total) * 100).toFixed(1) : "0.0";
      console.log(`\n▶ ${gateLabels[gate]}:`);
      console.log(`  Count: ${g.count} (${pct}%)`);
      if (g.samples.length > 0) {
        console.log(`  Representative Samples:`);
        g.samples.slice(0, 5).forEach((s, idx) => {
          console.log(`    ${idx + 1}. [${s.company}] "${s.title}" (${s.location || "N/A"})`);
        });
      }
    }

    console.log(`\n${"─".repeat(65)}`);
    console.log(`📊 BREAKDOWN BY SOURCE`);
    console.log(`${"─".repeat(65)}`);
    for (const [source, sData] of Object.entries(stats.bySource)) {
      const primaryCount = sData.byGate.passed_primary || 0;
      const stretchCount = sData.byGate.passed_stretch || 0;
      const totalPassed = primaryCount + stretchCount;
      const passPct = sData.total > 0 ? ((totalPassed / sData.total) * 100).toFixed(1) : "0.0";
      console.log(`\n• [${source.toUpperCase()}] Total: ${sData.total} | Passed: ${totalPassed} (${passPct}%) [${primaryCount} primary, ${stretchCount} stretch]`);
      for (const gate of GATES) {
        if (gate.startsWith("passed")) continue;
        const count = sData.byGate[gate] || 0;
        const pct = sData.total > 0 ? ((count / sData.total) * 100).toFixed(1) : "0.0";
        console.log(`    - ${gate}: ${count} (${pct}%)`);
      }
    }

    // Compute aggregate metrics on unique matched jobs
    const uniquePrimary = unique.filter(j => !j.is_stretch).length;
    const uniqueStretch = unique.filter(j => j.is_stretch).length;
    const freshnessCounts = { hot: 0, fresh: 0, active: 0 };
    const locationCounts = {};
    for (const j of unique) {
      freshnessCounts[j.freshness_tier] = (freshnessCounts[j.freshness_tier] || 0) + 1;
      const loc = j.remote ? "Remote" : (j.location || "India").split(",")[0].trim();
      locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    }

    console.log(`\n${"─".repeat(65)}`);
    console.log(`📈 MATCH AGGREGATES BREAKDOWN (Unique Matches)`);
    console.log(`${"─".repeat(65)}`);
    console.log(`• Match Type:     ${uniquePrimary} Primary  |  ${uniqueStretch} Stretch Opportunity`);
    console.log(`• Freshness:      ${freshnessCounts.hot || 0} Hot (0–7d)  |  ${freshnessCounts.fresh || 0} Fresh (8–14d)  |  ${freshnessCounts.active || 0} Active (15–30d)`);
    console.log(`• Top Locations:  ${Object.entries(locationCounts).sort((a,b)=>b[1]-a[1]).slice(0, 6).map(([k,v]) => `${k} (${v})`).join(", ")}`);
    console.log(`${"═".repeat(65)}\n`);

    console.log(`\n${"─".repeat(50)}`);
    console.log(`✅ ${unique.length} matching jobs found (${uniquePrimary} primary, ${uniqueStretch} stretch) | ⚠️ ${errors.length} errors`);
    if (debugMode) console.log(`📊 Total job postings fetched across all companies: ${totalFetchedJobs}`);
    console.log(`${"─".repeat(50)}\n`);

    const tier1 = unique.filter(j => j.tier === "1");

    function formatJobBadge(j) {
      const freshIcon = j.freshness_tier === "hot" ? "🟢 0-7d" : (j.freshness_tier === "fresh" ? "🟡 8-14d" : "⚪ 15-30d");
      const prioTag = j.priority ? ` [${j.priority}]` : "";
      const stretchTag = j.is_stretch ? " [STRETCH]" : "";
      const fnTag = j.function ? ` [${j.function}]` : "";
      return `${freshIcon}${prioTag}${stretchTag}${fnTag}`;
    }

    if (tier1.length) {
      console.log(`🏆 Tier 1 Companies (${tier1.length} matches):`);
      tier1.forEach((j, i) =>
        console.log(`  ${i+1}. ${j.company.padEnd(18)} ${j.title}\n     📍 ${(j.location||"India").padEnd(30)} ${formatJobBadge(j)}\n     🔗 ${j.url}\n`));
    }

    console.log(`\n💾 Full list saved to ${path.relative(ROOT, outputPath)}`);
    console.log(`\nNext steps:`);
    console.log(`  → Open Claude Code or Gemini CLI in this folder`);
    console.log(`  → /evaluate [any URL above]  to get a full A–F score\n`);
  }

  return {
    scanned_at: out.scanned_at,
    total: unique.length,
    errors: errors.length,
    jobs: unique,
    totalCompanies
  };
}

if (process.argv[1] && (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) || process.argv[1].endsWith("scan.mjs"))) {
  runScan().catch(err => {
    console.error(`❌ Scan failed: ${err.message}`);
    process.exit(1);
  });
}

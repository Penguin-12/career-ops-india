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
import { computeCacheKey } from "./ai/evaluator.mjs";

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

// ── Taxonomy & Classification ────────────────────────────────────────────────
import { GATES, classifyJob } from "./taxonomy.mjs";

const stats = {
  total: 0,
  byGate: Object.fromEntries(GATES.map(g => [g, { count: 0, samples: [] }])),
  bySource: {}
};

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

  // Re-attach existing cached AI evaluations if present.
  // Uses the same canonical SHA-256 cache key as evaluator.mjs (computeCacheKey) so that
  // evaluations persisted by the pipeline or a prior /evaluate call survive the next scan
  // without requiring daily-pipeline to run again. Zero AI tokens consumed here.
  const dataDir = path.join(ROOT, "data");
  const cachePath = path.join(dataDir, ".ai_cache.json");
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      // Load profile + CV text — same paths & fallbacks used by evaluateBatch()
      const profilePath = fs.existsSync(path.join(ROOT, "config/profile.yml"))
        ? path.join(ROOT, "config/profile.yml")
        : path.join(ROOT, "config/profile.example.yml");
      const cvPath = fs.existsSync(path.join(ROOT, "cv.md"))
        ? path.join(ROOT, "cv.md")
        : path.join(ROOT, "templates/cv-template.md");
      if (fs.existsSync(cvPath)) {
        const profileText = fs.existsSync(profilePath)
          ? fs.readFileSync(profilePath, "utf8")
          : "";
        const cvText = fs.readFileSync(cvPath, "utf8");
        let reattached = 0;
        unique.forEach(j => {
          const cacheKey = computeCacheKey(j, profileText, cvText);
          if (cache[cacheKey]) {
            j.ai_evaluation = { ...cache[cacheKey], cached: true };
            reattached++;
          }
        });
        if (!silent && !jsonMode && reattached > 0) {
          console.log(`  🤖 Re-attached ${reattached} cached AI evaluation(s) from .ai_cache.json`);
        }
      }
    } catch {}
  }

  // Sort: Tier 1 Primary (Today > Hot > Fresh > Active > Backlog > Unstated) > Tier 1 Stretch > Tier 2 Primary > Tier 2 Stretch
  const freshnessRank = { today: 0, hot: 1, fresh: 2, active: 3, backlog: 4, unstated: 5, expired: 6 };
  unique.sort((a, b) => {
    const aTier = a.tier === "0" ? 0 : (a.tier === "1" ? 1 : 2);
    const bTier = b.tier === "0" ? 0 : (b.tier === "1" ? 1 : 2);
    if (aTier !== bTier) return aTier - bTier;

    const aStretch = a.is_stretch ? 1 : 0;
    const bStretch = b.is_stretch ? 1 : 0;
    if (aStretch !== bStretch) return aStretch - bStretch;

    const aFresh = freshnessRank[a.freshness_tier] ?? 5;
    const bFresh = freshnessRank[b.freshness_tier] ?? 5;
    if (aFresh !== bFresh) return aFresh - bFresh;

    if (a.age_days != null && b.age_days != null) {
      return a.age_days - b.age_days;
    }
    if (a.age_days != null) return -1;
    if (b.age_days != null) return 1;
    return 0;
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
      hard_excluded_devops_sre: "4. Hard Exclusion: DevOps / SRE / DevSecOps / Site Reliability",
      hard_excluded_intern: "5. Hard Exclusion: Internships / Apprenticeships / Trainees",
      hard_excluded_hardware: "6. Hard Exclusion: Hardware / Silicon / Verification / Physical Design",
      function_mismatch: "7. Function Mismatch: No Backend/Platform/AI/SDE signal",
      location_mismatch: "8. Location Mismatch: Outside Target India Hubs / Non-Remote",
      experience_mismatch: "9. Experience Mismatch: Requirements far exceed profile (>7 yrs)",
      freshness_mismatch: "10. Stale / Expired (> 30 days old)",
      passed_primary: "11. Passed: Primary Match (IC SDE I / II / III within 2-4 yrs)",
      passed_stretch: "12. Passed: Stretch Match (Lead / Staff / Principal / 5-7 yrs)"
    };

    console.log(`── Step-by-Step Gate Breakdown ──`);
    for (const gate of GATES) {
      const g = stats.byGate[gate];
      const pct = stats.total > 0 ? ((g.count / stats.total) * 100).toFixed(1) : "0.0";
      console.log(`\n▶ ${gateLabels[gate] || gate}:`);
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
    const freshnessCounts = { today: 0, hot: 0, fresh: 0, active: 0, backlog: 0, unstated: 0 };
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
    console.log(`• Freshness:      ${freshnessCounts.today || 0} Today (<24h)  |  ${freshnessCounts.hot || 0} Hot (1–3d)  |  ${freshnessCounts.fresh || 0} Fresh (4–7d)  |  ${freshnessCounts.active || 0} Active (8–14d)  |  ${freshnessCounts.backlog || 0} Backlog (15–30d)  |  ${freshnessCounts.unstated || 0} Unstated`);
    console.log(`• Top Locations:  ${Object.entries(locationCounts).sort((a,b)=>b[1]-a[1]).slice(0, 6).map(([k,v]) => `${k} (${v})`).join(", ")}`);
    console.log(`${"═".repeat(65)}\n`);

    console.log(`\n${"─".repeat(50)}`);
    console.log(`✅ ${unique.length} matching jobs found (${uniquePrimary} primary, ${uniqueStretch} stretch) | ⚠️ ${errors.length} errors`);
    if (debugMode) console.log(`📊 Total job postings fetched across all companies: ${totalFetchedJobs}`);
    console.log(`${"─".repeat(50)}\n`);

    const tier1 = unique.filter(j => j.tier === "1");

    function formatJobBadge(j) {
      let freshIcon;
      switch (j.freshness_tier) {
        case "today": freshIcon = "🔥 <24h"; break;
        case "hot": freshIcon = "🟢 1-3d"; break;
        case "fresh": freshIcon = "🟡 4-7d"; break;
        case "active": freshIcon = "⚪ 8-14d"; break;
        case "backlog": freshIcon = "⚪ 15-30d"; break;
        default: freshIcon = "⚪ Unstated"; break;
      }
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

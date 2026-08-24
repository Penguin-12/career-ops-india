#!/usr/bin/env node
/**
 * scripts/audit-company-coverage.mjs — Company Coverage Audit & Priority Ranking
 * 
 * Uses portals/candidates.yml as the canonical company universe.
 * Evaluates coverage against portals/india.yml, portals/migrations.yml,
 * and data/scan_results.json.
 * 
 * Run:  node scripts/audit-company-coverage.mjs
 * Run:  npm run audit:coverage
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

function loadYaml(relPath) {
  const p = path.join(ROOT, relPath);
  if (!fs.existsSync(p)) return null;
  return yaml.load(fs.readFileSync(p, "utf8"));
}

function loadJson(relPath) {
  const p = path.join(ROOT, relPath);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeName(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function main() {
  const candidatesData = loadYaml("portals/candidates.yml") || { companies: [] };
  const indiaData = loadYaml("portals/india.yml") || {};
  const migrationsData = loadYaml("portals/migrations.yml") || {};
  const scanData = loadJson("data/scan_results.json") || { jobs: [] };
  const discoveryData = loadJson("data/source_discovery.json") || { results: [] };

  const universe = candidatesData.companies || [];

  // Map active companies in portals/india.yml
  const activeMap = new Map();
  for (const [board, list] of Object.entries(indiaData)) {
    if (Array.isArray(list)) {
      list.forEach(co => {
        activeMap.set(normalizeName(co.name), { ...co, board });
      });
    }
  }

  // Map protected/unsupported in portals/migrations.yml
  const migrationMap = new Map();
  for (const [category, list] of Object.entries(migrationsData)) {
    if (Array.isArray(list)) {
      list.forEach(co => {
        migrationMap.set(normalizeName(co.name), { ...co, category });
      });
    }
  }

  // Map discovery evidence
  const discoveryMap = new Map();
  if (Array.isArray(discoveryData.results)) {
    discoveryData.results.forEach(res => {
      discoveryMap.set(normalizeName(res.company), res);
    });
  }

  // Map job matches from scan_results.json
  const matchCounts = new Map();
  (scanData.jobs || []).forEach(j => {
    const k = normalizeName(j.company);
    matchCounts.set(k, (matchCounts.get(k) || 0) + 1);
  });

  // State classification for every company
  const states = {
    COVERED: [],
    VERIFIED_NO_OPENINGS: [],
    DISCOVERED_UNSUPPORTED: [],
    PROTECTED: [],
    UNKNOWN: [],
    DEFUNCT: []
  };

  for (const co of universe) {
    const norm = normalizeName(co.name);
    const active = activeMap.get(norm);
    const migration = migrationMap.get(norm);
    const discovery = discoveryMap.get(norm);

    if (active) {
      const matchCount = matchCounts.get(norm) || 0;
      if (matchCount > 0) {
        states.COVERED.push({ ...co, board: active.board, matchCount });
      } else {
        states.VERIFIED_NO_OPENINGS.push({ ...co, board: active.board, matchCount: 0 });
      }
      continue;
    }

    if (migration) {
      if (migration.status === "blocked" || migration.status === "auth_required" || migration.category === "darwinbox" || migration.category === "keka") {
        states.PROTECTED.push({ ...co, reason: migration.reason, category: migration.category });
      } else if (migration.status === "adapter_needed" || migration.category === "workday") {
        states.DISCOVERED_UNSUPPORTED.push({ ...co, ats: migration.category, reason: migration.reason });
      } else {
        states.DISCOVERED_UNSUPPORTED.push({ ...co, ats: migration.category || "custom", reason: migration.reason });
      }
      continue;
    }

    if (discovery) {
      if (["workday", "phenom", "eightfold", "successfactors", "taleo", "icims"].includes(discovery.ats)) {
        states.DISCOVERED_UNSUPPORTED.push({ ...co, ats: discovery.ats, evidence: discovery.evidence });
      } else if (discovery.status === "unsupported" || /cloudflare|anti-bot|403/i.test(discovery.evidence || "")) {
        states.PROTECTED.push({ ...co, reason: discovery.evidence, category: discovery.ats });
      } else if (co.status === "defunct") {
        states.DEFUNCT.push(co);
      } else {
        states.UNKNOWN.push({ ...co, evidence: discovery.evidence });
      }
      continue;
    }

    states.UNKNOWN.push(co);
  }

  // ── Print Terminal Audit ──────────────────────────────────────────────────
  const total = universe.length;
  console.log(`\n${"═".repeat(68)}`);
  console.log(`📊 COMPANY COVERAGE AUDIT`);
  console.log(`${"═".repeat(68)}`);
  console.log(`Target Company Universe: ${total} companies\n`);

  const pct = (cnt) => ((cnt / total) * 100).toFixed(1);
  console.log(`  🟢 COVERED:                     ${String(states.COVERED.length).padStart(3)} / ${total}  (${pct(states.COVERED.length)}%)`);
  console.log(`  🟡 VERIFIED — NO OPENINGS:      ${String(states.VERIFIED_NO_OPENINGS.length).padStart(3)} / ${total}  (${pct(states.VERIFIED_NO_OPENINGS.length)}%)`);
  console.log(`  🔵 DISCOVERED — UNSUPPORTED:    ${String(states.DISCOVERED_UNSUPPORTED.length).padStart(3)} / ${total}  (${pct(states.DISCOVERED_UNSUPPORTED.length)}%)`);
  console.log(`  🔴 PROTECTED / AUTH-REQUIRED:   ${String(states.PROTECTED.length).padStart(3)} / ${total}  (${pct(states.PROTECTED.length)}%)`);
  console.log(`  ⚪ UNKNOWN / CUSTOM SITE:       ${String(states.UNKNOWN.length).padStart(3)} / ${total}  (${pct(states.UNKNOWN.length)}%)`);
  console.log(`  ⚫ DEFUNCT:                     ${String(states.DEFUNCT.length).padStart(3)} / ${total}  (${pct(states.DEFUNCT.length)}%)`);

  console.log(`\n${"═".repeat(68)}`);
  console.log(`🏆 COVERED COMPANIES (${states.COVERED.length} active with matches)`);
  console.log(`${"═".repeat(68)}`);

  const t1Covered = states.COVERED.filter(c => c.tier === "1");
  const t2Covered = states.COVERED.filter(c => c.tier !== "1");

  console.log(`\nTier 1 (${t1Covered.length}):`);
  t1Covered.forEach(c => {
    console.log(`  ✓ ${c.name.padEnd(24)} [${c.board}] — ${c.matchCount} match${c.matchCount > 1 ? "es" : ""}`);
  });

  if (t2Covered.length > 0) {
    console.log(`\nTier 2 (${t2Covered.length}):`);
    t2Covered.forEach(c => {
      console.log(`  ✓ ${c.name.padEnd(24)} [${c.board}] — ${c.matchCount} match${c.matchCount > 1 ? "es" : ""}`);
    });
  }

  if (states.VERIFIED_NO_OPENINGS.length > 0) {
    console.log(`\n${"─".repeat(68)}`);
    console.log(`🟡 VERIFIED — CURRENTLY NO OPENINGS (${states.VERIFIED_NO_OPENINGS.length})`);
    console.log(`${"─".repeat(68)}`);
    states.VERIFIED_NO_OPENINGS.forEach(c => {
      console.log(`  • ${c.name.padEnd(24)} [${c.board}] — 0 openings found (board verified live)`);
    });
  }

  console.log(`\n${"═".repeat(68)}`);
  console.log(`🔍 NOT YET COVERED BREAKDOWN`);
  console.log(`${"═".repeat(68)}`);

  console.log(`\n--- DISCOVERED BUT UNSUPPORTED (${states.DISCOVERED_UNSUPPORTED.length}) ---`);
  states.DISCOVERED_UNSUPPORTED.slice(0, 15).forEach(c => {
    console.log(`  • ${c.name.padEnd(25)} ATS: ${(c.ats || "unsupported").padEnd(14)} (${c.domain || "Tech"})`);
  });
  if (states.DISCOVERED_UNSUPPORTED.length > 15) {
    console.log(`  ... and ${states.DISCOVERED_UNSUPPORTED.length - 15} more`);
  }

  console.log(`\n--- PROTECTED / AUTH REQUIRED (${states.PROTECTED.length}) ---`);
  states.PROTECTED.forEach(c => {
    console.log(`  • ${c.name.padEnd(25)} [${(c.category || "protected").toUpperCase()}] ${c.reason || "Cloudflare / OAuth"}`);
  });

  console.log(`\n--- UNKNOWN / CUSTOM SITES (${states.UNKNOWN.length}) ---`);
  states.UNKNOWN.slice(0, 12).forEach(c => {
    console.log(`  • ${c.name.padEnd(25)} (${c.domain || "Tech"}) — ${c.careers_url || "N/A"}`);
  });
  if (states.UNKNOWN.length > 12) {
    console.log(`  ... and ${states.UNKNOWN.length - 12} more`);
  }

  // ── Coverage by Category ──────────────────────────────────────────────────
  console.log(`\n${"═".repeat(68)}`);
  console.log(`📊 COVERAGE BY COMPANY CATEGORY`);
  console.log(`${"═".repeat(68)}`);

  const categories = {
    "Big Tech / Global Tech": (c) => /big-tech|consumer-tech|social|search|enterprise-cloud|enterprise-saas|enterprise-erp/i.test(c.domain || "") || ["google", "microsoft", "amazon", "apple", "meta", "adobe", "salesforce", "uber", "nvidia", "linkedin", "atlassian", "intuit", "servicenow", "oracle", "sap"].includes(normalizeName(c.name)),
    "Indian Unicorns & Consumer Tech": (c) => /e-commerce|fintech|quick-commerce|foodtech|mobility|gaming|travel-tech|edtech|healthtech/i.test(c.domain || "") && !/gcc/i.test(c.domain || ""),
    "AI, ML & Data Platforms": (c) => /ai|ml|data|analytics|conversational-ai|contact-center-ai|llm/i.test(c.domain || ""),
    "Developer Infrastructure & Security": (c) => /devtools|devsecops|cybersecurity|cloud|database|networking|storage|observability|kafka|siem/i.test(c.domain || ""),
    "GCCs & Financial Tech Enterprises": (c) => /gcc|investment-banking|banking|payments-network|retail-tech|industrial|automotive|aerospace|energy|consulting/i.test(c.domain || "")
  };

  for (const [catName, filterFn] of Object.entries(categories)) {
    const totalInCat = universe.filter(filterFn);
    const coveredInCat = totalInCat.filter(c => activeMap.has(normalizeName(c.name)));
    const cPct = totalInCat.length > 0 ? ((coveredInCat.length / totalInCat.length) * 100).toFixed(1) : "0.0";
    console.log(`  • ${catName.padEnd(38)} ${String(coveredInCat.length).padStart(2)} / ${String(totalInCat.length).padStart(2)}  (${cPct}%)`);
  }

  // ── Top Uncovered Companies Ranking ───────────────────────────────────────
  console.log(`\n${"═".repeat(68)}`);
  console.log(`🎯 TOP UNCOVERED COMPANIES (Priority Ranking)`);
  console.log(`${"═".repeat(68)}`);

  const uncovered = universe.filter(c => !activeMap.has(normalizeName(c.name)));

  // Rank formula: Tier 1 (+20), Big Tech / DevTools (+15), High Feasibility / Workday (+10)
  uncovered.forEach(c => {
    let score = 0;
    if (c.tier === "1") score += 30; else score += 10;
    if (/big-tech|devtools|ai|cloud|fintech/i.test(c.domain || "")) score += 20;
    if (migrationMap.has(normalizeName(c.name))) {
      const m = migrationMap.get(normalizeName(c.name));
      if (m.category === "workday") score += 15;
    }
    const d = discoveryMap.get(normalizeName(c.name));
    if (d?.ats === "workday") score += 20;
    if (d?.ats === "phenom" || d?.ats === "eightfold") score += 10;
    c._priorityScore = score;
  });

  uncovered.sort((a, b) => b._priorityScore - a._priorityScore);

  console.log(`Top 20 Uncovered Target Employers:`);
  uncovered.slice(0, 20).forEach((c, idx) => {
    const d = discoveryMap.get(normalizeName(c.name));
    const sys = d?.ats || "Custom / Unknown";
    console.log(`  ${String(idx + 1).padStart(2)}. ${c.name.padEnd(24)} Tier ${c.tier} | ${(c.domain || "Tech").padEnd(25)} [System: ${sys}]`);
  });

  console.log(`\n${"═".repeat(68)}\n`);
}

main();

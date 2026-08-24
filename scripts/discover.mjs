#!/usr/bin/env node
/**
 * scripts/discover.mjs — Automated ATS / Career Source Discovery
 * 
 * Inspects official careers URLs, follows redirects, detects career systems
 * (Greenhouse, Lever, Ashby, SmartRecruiters, MyNextHire, Workday, Darwinbox, Keka, etc.),
 * and writes machine-readable evidence to data/source_discovery.json.
 * 
 * Run:  npm run discover
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Known ATS URL & signature patterns
const ATS_SIGNATURES = [
  { id: "greenhouse", name: "Greenhouse", pattern: /(?:job-boards|boards|boards-api)\.greenhouse\.io\/([^/?#]+)|gh_jid=|grnh\.se/i, slugIndex: 1 },
  { id: "lever", name: "Lever", pattern: /jobs\.lever\.co\/([^/?#]+)/i, slugIndex: 1 },
  { id: "ashby", name: "Ashby", pattern: /jobs\.ashbyhq\.com\/([^/?#]+)/i, slugIndex: 1 },
  { id: "smartrecruiters", name: "SmartRecruiters", pattern: /jobs\.smartrecruiters\.com\/([^/?#]+)/i, slugIndex: 1 },
  { id: "mynexthire", name: "MyNextHire", pattern: /([a-z0-9_-]+)\.mynexthire\.com/i, slugIndex: 1 },
  { id: "workday", name: "Workday", pattern: /([a-z0-9_-]+)\.(?:wd\d+)?\.?myworkdayjobs\.com/i, slugIndex: 1 },
  { id: "darwinbox", name: "Darwinbox", pattern: /([a-z0-9_-]+)\.darwinbox\.in/i, slugIndex: 1 },
  { id: "keka", name: "Keka", pattern: /([a-z0-9_-]+)\.(?:keka\.com|kekahire\.com)/i, slugIndex: 1 },
  { id: "eightfold", name: "Eightfold AI", pattern: /([a-z0-9_-]+)\.eightfold\.ai/i, slugIndex: 1 },
  { id: "icims", name: "iCIMS", pattern: /([a-z0-9_-]+)\.icims\.com/i, slugIndex: 1 },
  { id: "phenom", name: "Phenom People", pattern: /phenompeople\.com|phenom\.com/i, slugIndex: null },
  { id: "successfactors", name: "SAP SuccessFactors", pattern: /successfactors\.com|jobs2web\.com/i, slugIndex: null },
  { id: "taleo", name: "Oracle Taleo", pattern: /taleo\.net/i, slugIndex: null }
];

async function verifyATSslug(ats, slug) {
  if (!slug) return false;
  try {
    if (ats === "greenhouse") {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    }
    if (ats === "lever") {
      const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    }
    if (ats === "ashby") {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    }
    if (ats === "smartrecruiters") {
      const res = await fetch(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    }
    if (ats === "mynexthire") {
      const res = await fetch(`https://${slug}.mynexthire.com/careers/service.action?serviceType=allJobs`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function discoverCompany(company) {
  // If already verified with working slug, preserve it
  if (company.status === "verified" && company.ats && company.ats_slug) {
    return {
      company: company.name,
      tier: company.tier,
      careers_url: company.careers_url,
      ats: company.ats,
      slug: company.ats_slug,
      status: "verified",
      evidence: company.notes || "Verified working source endpoint in active registry",
      checked_at: new Date().toISOString()
    };
  }

  if (!company.careers_url) {
    return {
      company: company.name,
      tier: company.tier,
      careers_url: null,
      ats: "unknown",
      slug: null,
      status: "needs_verification",
      evidence: "No official careers URL configured",
      checked_at: new Date().toISOString()
    };
  }

  try {
    const res = await fetch(company.careers_url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(7000)
    });

    const finalUrl = res.url || company.careers_url;
    let html = "";
    try {
      html = await res.text();
    } catch(e) {}

    // Check final URL & HTML against ATS signatures
    const combinedContent = `${finalUrl}\n${html.slice(0, 50000)}`;

    for (const sig of ATS_SIGNATURES) {
      const match = combinedContent.match(sig.pattern);
      if (match) {
        let extractedSlug = sig.slugIndex ? match[sig.slugIndex] : null;
        if (extractedSlug) {
          extractedSlug = extractedSlug.split(/[?#/]/)[0].toLowerCase();
        }

        // If supported ATS, test if slug is live
        let isLive = false;
        if (["greenhouse", "lever", "ashby", "smartrecruiters", "mynexthire"].includes(sig.id) && extractedSlug) {
          isLive = await verifyATSslug(sig.id, extractedSlug);
        }

        const isUnsupported = ["workday", "darwinbox", "keka", "eightfold", "icims", "phenom", "successfactors", "taleo"].includes(sig.id);

        return {
          company: company.name,
          tier: company.tier,
          careers_url: company.careers_url,
          ats: sig.id,
          slug: extractedSlug || null,
          status: isLive ? "verified" : (isUnsupported ? "unsupported" : "needs_verification"),
          evidence: `Detected ${sig.name} from pattern (${finalUrl})${isLive ? " [API verified live]" : ""}`,
          checked_at: new Date().toISOString()
        };
      }
    }

    // If HTTP error code
    if (res.status === 403 || res.status === 429) {
      return {
        company: company.name,
        tier: company.tier,
        careers_url: company.careers_url,
        ats: "unknown",
        slug: null,
        status: "unsupported",
        evidence: `HTTP ${res.status} (Protected by Cloudflare/Anti-bot)`,
        checked_at: new Date().toISOString()
      };
    }

    return {
      company: company.name,
      tier: company.tier,
      careers_url: company.careers_url,
      ats: "custom",
      slug: null,
      status: "needs_verification",
      evidence: `Custom career site rendered (${finalUrl})`,
      checked_at: new Date().toISOString()
    };

  } catch (err) {
    return {
      company: company.name,
      tier: company.tier,
      careers_url: company.careers_url,
      ats: "unknown",
      slug: null,
      status: "needs_verification",
      evidence: `Connection error: ${err.message}`,
      checked_at: new Date().toISOString()
    };
  }
}

async function main() {
  const candidatesPath = path.join(ROOT, "portals/candidates.yml");
  if (!fs.existsSync(candidatesPath)) {
    console.error("❌ portals/candidates.yml not found.");
    process.exit(1);
  }

  const data = yaml.load(fs.readFileSync(candidatesPath, "utf8")) || {};
  const companies = data.companies || [];

  console.log(`\n🔍 Running Automated Career Source Discovery`);
  console.log(`   Universe Size: ${companies.length} companies\n`);

  const results = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    process.stdout.write(`Scanning companies ${i + 1}–${Math.min(i + BATCH_SIZE, companies.length)} of ${companies.length}...`);
    const batchResults = await Promise.all(batch.map(discoverCompany));
    results.push(...batchResults);
    console.log(" ✓");
  }

  // Save to data/source_discovery.json
  const dataDir = path.join(ROOT, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const outData = {
    scanned_at: new Date().toISOString(),
    total: results.length,
    results
  };
  fs.writeFileSync(path.join(dataDir, "source_discovery.json"), JSON.stringify(outData, null, 2), "utf8");

  // Summary Metrics
  const atsCounts = {};
  const statusCounts = {};

  for (const r of results) {
    atsCounts[r.ats || "unknown"] = (atsCounts[r.ats || "unknown"] || 0) + 1;
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 SOURCE DISCOVERY SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Total Companies Evaluated: ${results.length}\n`);

  console.log(`ATS / Career System Breakdown:`);
  console.log(`--------------------------------`);
  Object.entries(atsCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([ats, count]) => {
      console.log(`  ${ats.padEnd(20)} ${count}`);
    });

  console.log(`\nStatus Breakdown:`);
  console.log(`--------------------------------`);
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([st, count]) => {
      console.log(`  ${st.padEnd(20)} ${count}`);
    });

  console.log(`\n💾 Saved detailed results to data/source_discovery.json\n`);
}

main();

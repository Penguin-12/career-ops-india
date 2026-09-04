/**
 * scripts/adapters/radancy.mjs — Radancy / TalentBrew Career Platform Adapter
 * 
 * Reusable adapter for employer portals powered by Radancy / TalentBrew:
 * - Barclays (search.jobs.barclays)
 * - Capital One (www.capitalonecareers.com)
 * - Intuit (jobs.intuit.com)
 * - Arm (careers.arm.com)
 * - Palo Alto Networks (jobs.paloaltonetworks.com)
 * - Charles Schwab (www.schwabjobs.com)
 * - Optum / UnitedHealth Group (careers.unitedhealthgroup.com)
 * 
 * Features:
 * - Unauthenticated public search endpoint querying India requisitions
 * - Robust HTML entity decoding & multi-tenant DOM card parsing
 * - Pagination via Radancy facet URL scheme
 * - Deterministic extraction of stable job IDs, titles, locations, and canonical URLs
 * - Zero LLM tokens. Zero browser automation.
 */

import { fetchWithRetry } from "./http.mjs";

function decodeHtml(html) {
  return String(html || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRadancyCards(html, domain, prefix = "") {
  if (!html || typeof html !== "string") return [];
  const jobs = [];
  const linkRegex = /<a[^>]*href="([^"]*\/job\/[^"]*)"(?:[^>]*data-job-id="([^"]*)")?[\s\S]*?>([\s\S]*?)<\/a>/gi;
  
  for (const match of html.matchAll(linkRegex)) {
    const rawHref = match[1];
    let dataJobId = match[2];
    const innerHtml = match[3];
    
    // Extract Title
    let title = "";
    const hMatch = innerHtml.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i) || innerHtml.match(/class="[^"]*job-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (hMatch) {
      title = decodeHtml(hMatch[1].replace(/<[^>]+>/g, ""));
    } else {
      const rawLines = innerHtml.replace(/<[^>]+>/g, "\n").split("\n");
      const cleanLines = rawLines
        .map(l => decodeHtml(l))
        .filter(Boolean);
      // Select the first line that is not purely numeric (ID) or date or city
      title = cleanLines.find(line => !/^\d+$/.test(line) && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line) && !/^(Bengaluru|Bangalore|Hyderabad|Pune|Mumbai|India)$/i.test(line)) || cleanLines[0] || "Software Engineer";
    }

    // Canonical absolute URL
    const fullUrl = rawHref.startsWith("http") 
      ? rawHref 
      : `https://${domain}${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;

    // Job ID extraction
    if (!dataJobId) {
      const urlIdMatch = fullUrl.match(/\/(\d{4,})\/?(?:[?#]|$)/);
      if (urlIdMatch) dataJobId = urlIdMatch[1];
    }

    // Location extraction
    let location = "India";
    const locMatch = innerHtml.match(/class="[^"]*(?:job-location|location)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (locMatch) {
      location = decodeHtml(locMatch[1].replace(/<[^>]+>/g, ""));
    } else {
      const locTextMatch = innerHtml.match(/\b(Bengaluru|Bangalore|Hyderabad|Pune|Mumbai|Noida|Gurgaon|Gurugram|Chennai|India)\b[^<]*/i);
      if (locTextMatch) location = decodeHtml(locTextMatch[0]);
    }

    // Posted date extraction
    let posted_at = null;
    const dateMatch = innerHtml.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (dateMatch) {
      const month = dateMatch[1].padStart(2, "0");
      const day = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3];
      posted_at = `${year}-${month}-${day}T00:00:00.000Z`;
    }

    jobs.push({
      id: dataJobId || null,
      title,
      location,
      url: fullUrl,
      posted_at,
      rawHtml: innerHtml.slice(0, 200)
    });
  }

  return jobs;
}

export default {
  id: "radancy",
  type: "employer_careers",

  async fetchJobs(companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "Company" };
    const domain = company.host || company.domain_host || (typeof company.domain === "string" && company.domain.includes(".") ? company.domain : "");
    if (!domain) return { jobs: [], err: "Missing Radancy host configuration" };

    const orgId = company.orgId || company.org_id || "0";
    const prefix = company.path_prefix || company.prefix || "";
    const maxPages = company.maxPages || 50;
    const allJobs = [];
    const seenKeys = new Set();
    let totalPages = Infinity;
    let hitEmergencyCap = false;

    try {
      let currentUrl = `https://${domain}/${prefix}search-jobs/India/${orgId}/2/1269750/20/77/50/1`;
      let page = 1;

      while (currentUrl && page <= totalPages && page <= maxPages) {
        const res = await fetchWithRetry(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }, { maxRetries: 5, timeoutMs: 20000 });

        if (!res.ok) {
          if (page === 1) {
            return { jobs: [], err: `HTTP ${res.status} from ${domain}` };
          }
          break;
        }

        const html = await res.text();
        const pageJobs = parseRadancyCards(html, domain, prefix);
        if (pageJobs.length === 0) break;

        let newJobsOnPage = 0;
        for (const job of pageJobs) {
          const key = job.url || job.id || `${job.title}|${job.location}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allJobs.push(job);
            newJobsOnPage++;
          }
        }

        // Detect total pages if available
        const totalPagesMatch = html.match(/data-total-pages="(\d+)"/i);
        if (totalPagesMatch) {
          const parsed = parseInt(totalPagesMatch[1], 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            totalPages = parsed;
          }
        }

        if (page >= maxPages && page < totalPages) {
          hitEmergencyCap = true;
        }

        if (newJobsOnPage === 0 && page > 1) break;

        // Determine next URL: check canonical next link, or fallback to ?p=
        const nextMatch = html.match(/<a[^>]*class="[^"]*next[^"]*"[^>]*href="([^"]*)"/i) || html.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*next[^"]*"/i);
        const isNextDisabled = /<a[^>]*class="[^"]*next[^"]*disabled/i.test(html) || /class="[^"]*disabled[^"]*next/i.test(html);

        if (nextMatch && nextMatch[1] && !isNextDisabled) {
          let nextHref = nextMatch[1].replace(/&amp;/g, "&");
          if (nextHref.includes("&p=") && !nextHref.includes("?")) {
            nextHref = nextHref.replace("&p=", "?p=");
          }
          currentUrl = nextHref.startsWith("http") ? nextHref : `https://${domain}${nextHref.startsWith("/") ? "" : "/"}${nextHref}`;
          page++;
        } else if (page < totalPages) {
          page++;
          currentUrl = `https://${domain}/${prefix}search-jobs/India/${orgId}/2/1269750/20/77/50/1?p=${page}`;
        } else {
          break;
        }
      }

      const err = hitEmergencyCap
        ? `Pagination reached emergency circuit-breaker (${maxPages}) before consuming all ${totalPages} pages from ${domain}`
        : undefined;

      return { jobs: allJobs, ...(err ? { err } : {}) };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const title = rawJob.title || "Software Engineer";
    const location = rawJob.location || "India";
    const domain = company.host || company.domain_host || (typeof company.domain === "string" && company.domain.includes(".") ? company.domain : "careers");
    const applyUrl = rawJob.url || `https://${domain}`;
    const isRemote = /remote|virtual/i.test(title) || /remote/i.test(location);
    const posted_at = rawJob.posted_at || null;
    const department = rawJob.department || "";
    const snippet = `${title} - ${location}${rawJob.id ? ` [Req: ${rawJob.id}]` : ""}`.trim();

    return {
      source: "radancy",
      source_type: "employer_careers",
      company: company.name,
      tier: company.tier || "1",
      priority: company.priority || "GO",
      title,
      location,
      url: applyUrl,
      posted_at,
      department,
      remote: isRemote,
      snippet,
      _experienceText: `${title}\nCompany: ${company.name}\nLocation: ${location}`.slice(0, 5000)
    };
  }
};

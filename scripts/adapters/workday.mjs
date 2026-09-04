/**
 * scripts/adapters/workday.mjs — Workday ATS adapter
 * 
 * Uses the official public Workday CXS (Candidate Experience Service) JSON API.
 * Endpoint: POST https://{tenant}.{instance}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
 * 
 * Features:
 * - Pagination handling (limit, offset, total)
 * - Safe relative & absolute date parsing
 * - URL reconstruction for direct job links
 * - Location fallback extraction from externalPath for multi-location jobs
 * - Zero LLM tokens. Zero scraping. Clean JSON responses.
 */

import { fetchWithRetry } from "./http.mjs";

function parseWorkdayDate(postedOn, now = Date.now()) {
  if (!postedOn) return null;
  const s = String(postedOn).trim();
  if (/^posted\s+today/i.test(s)) {
    return new Date(now).toISOString();
  }
  if (/^posted\s+yesterday/i.test(s)) {
    return new Date(now - 86400000).toISOString();
  }
  const daysMatch = s.match(/^posted\s+(\d+)\s+days?\s+ago/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    return new Date(now - days * 86400000).toISOString();
  }
  if (/^posted\s+30\+\s+days\s+ago/i.test(s)) {
    return new Date(now - 31 * 86400000).toISOString();
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function resolveHost(company) {
  if (company.host) return company.host;
  const tenant = company.tenant || company.slug;
  const instance = company.instance ? `${company.instance}.` : "";
  return `${tenant}.${instance}myworkdayjobs.com`;
}

export default {
  id: "workday",
  type: "direct_ats",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { slug: slugOrCompany, tenant: slugOrCompany, site: "External" };
    const tenant = company.tenant || company.slug;
    const site = company.site || "External";
    const host = resolveHost(company);
    const endpoint = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

    const allJobs = [];
    const PAGE_SIZE = 20;
    const MAX_JOBS = 400; // Safety cap against infinite loops
    let offset = 0;
    let total = Infinity;

    try {
      // First attempt: search with "India" filter for high efficiency
      while (offset < total && offset < MAX_JOBS) {
        const bodyPayload = {
          limit: PAGE_SIZE,
          offset: offset,
          searchText: "India"
        };

        const res = await fetchWithRetry(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "career-ops-india/1.2"
          },
          body: JSON.stringify(bodyPayload)
        }, { maxRetries: 5, timeoutMs: 20000 });

        if (!res.ok) {
          // If 422 with searchText, fallback to standard pagination without searchText
          if (res.status === 422 && offset === 0) {
            break;
          }
          return { jobs: allJobs, err: `HTTP ${res.status} ${res.statusText}` };
        }

        const data = await res.json();
        const postings = Array.isArray(data.jobPostings) ? data.jobPostings : [];
        if (postings.length === 0) break;

        allJobs.push(...postings);
        total = typeof data.total === "number" ? data.total : allJobs.length;
        offset += postings.length;
      }

      // If searchText returned 0 or failed, fallback to general crawl
      if (allJobs.length === 0) {
        offset = 0;
        total = Infinity;
        while (offset < total && offset < 100) {
          const res = await fetchWithRetry(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "User-Agent": "career-ops-india/1.2"
            },
            body: JSON.stringify({ limit: PAGE_SIZE, offset: offset, appliedFacets: {} })
          }, { maxRetries: 5, timeoutMs: 20000 });

          if (!res.ok) break;
          const data = await res.json();
          const postings = Array.isArray(data.jobPostings) ? data.jobPostings : [];
          if (postings.length === 0) break;

          allJobs.push(...postings);
          total = typeof data.total === "number" ? data.total : allJobs.length;
          offset += postings.length;
        }
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const host = resolveHost(company);
    const site = company.site || "External";

    let url = company.careers_url || `https://${host}`;
    if (rawJob.externalPath) {
      url = `https://${host}/en-US/${site}${rawJob.externalPath}`;
    }

    const rawLocation = rawJob.locationsText || rawJob.location || "";
    let location = rawLocation;
    if (!location || /^\d+\s+locations?$/i.test(location.trim())) {
      const cityMatch = (rawJob.externalPath || "").match(/(bangalore|bengaluru|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai)/i);
      location = cityMatch ? cityMatch[1] : (rawLocation || "India");
    }

    const title = rawJob.title || "";
    const posted_at = parseWorkdayDate(rawJob.postedOn);
    const reqId = rawJob.bulletFields?.[0] || "";
    const isRemote = /remote|wfh/i.test(location) || /remote/i.test(title);

    return {
      source: "workday",
      company: company.name,
      tier: company.tier || "1",
      title,
      location,
      url,
      posted_at,
      department: reqId ? `Requisition ${reqId}` : "Engineering",
      remote: isRemote,
      snippet: `${title} - ${location} (${rawJob.postedOn || "Active"})`.trim(),
      _experienceText: `${title}\n${location}\n${reqId}`
    };
  }
};

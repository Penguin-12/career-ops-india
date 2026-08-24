/**
 * scripts/adapters/amazon.mjs — Amazon Jobs Public REST API Adapter
 * 
 * Endpoint: GET https://www.amazon.jobs/en/search.json?country=IND&category[]=software-development&result_limit=100
 * 
 * Features:
 * - Direct public unauthenticated JSON API
 * - Pagination via result_limit & offset
 * - Zero LLM tokens. Zero scraping. Clean JSON responses.
 */

import https from "https";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json"
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error(`Timeout after 8000ms requesting ${url}`));
    });
    req.on("error", reject);
  });
}

function parseAmazonDate(postedDate) {
  if (!postedDate) return null;
  const parsed = Date.parse(postedDate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export default {
  id: "amazon",
  type: "direct_ats",

  async fetchJobs(slugOrCompany) {
    const allJobs = [];
    const PAGE_SIZE = 100;
    const MAX_JOBS = 500; // Safety cap
    let offset = 0;
    let total = Infinity;

    try {
      while (offset < total && offset < MAX_JOBS) {
        const url = `https://www.amazon.jobs/en/search.json?country=IND&category[]=software-development&result_limit=${PAGE_SIZE}&offset=${offset}&sort=recent`;
        const data = await fetchJson(url);
        
        const hits = typeof data.hits === "number" ? data.hits : 0;
        const postings = Array.isArray(data.jobs) ? data.jobs : [];
        if (postings.length === 0) break;

        allJobs.push(...postings);
        total = hits;
        offset += postings.length;
      }
      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const title = rawJob.title || "";
    const city = rawJob.city || "India";
    const location = `${city}, India`;
    const url = rawJob.job_path ? `https://www.amazon.jobs${rawJob.job_path}` : (company.careers_url || "https://www.amazon.jobs");
    const posted_at = parseAmazonDate(rawJob.posted_date);
    const department = rawJob.business_category || rawJob.team || "Software Development";
    const isRemote = /remote|virtual/i.test(rawJob.location || "") || /remote/i.test(title);
    const basicQual = rawJob.basic_qualifications ? rawJob.basic_qualifications.replace(/<[^>]+>/g, " ") : "";
    const description = rawJob.description ? rawJob.description.replace(/<[^>]+>/g, " ") : "";

    return {
      source: "amazon",
      company: company.name || "Amazon",
      tier: company.tier || "1",
      priority: company.priority || "GO",
      title,
      location,
      url,
      posted_at,
      department,
      remote: isRemote,
      snippet: `${title} - ${location} (${rawJob.posted_date || "Active"})`.trim(),
      _experienceText: `${title}\n${location}\n${basicQual}\n${description}`.slice(0, 5000)
    };
  }
};

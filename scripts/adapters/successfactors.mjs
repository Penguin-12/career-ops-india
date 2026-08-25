/**
 * scripts/adapters/successfactors.mjs — SAP SuccessFactors Career Site Builder (CSB) Adapter
 * 
 * Target: SAP (jobs.sap.com) and other SAP SuccessFactors enterprise portals
 * 
 * Features:
 * - Direct public search query with India location search
 * - Pagination support via startrow parameter
 * - Clean HTML table extraction of title, location, requisition ID, and canonical URLs
 * - Zero LLM tokens. Zero browser automation.
 */

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

export function parseSuccessFactorsCards(html, domain) {
  if (!html || typeof html !== "string") return [];
  const jobs = [];
  const rowRegex = /<tr[^>]*class="[^"]*data-row[^"]*"[\s\S]*?<\/tr>/gi;
  const rows = [...html.matchAll(rowRegex)];

  for (const r of rows) {
    const rowHtml = r[0];
    const linkMatch = rowHtml.match(/<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const rawHref = linkMatch[1];
    const title = decodeHtml(linkMatch[2].replace(/<[^>]+>/g, ""));
    const fullUrl = rawHref.startsWith("http") 
      ? rawHref 
      : `https://${domain}${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;

    // Job ID extraction from URL (e.g. /job/.../1429157633/)
    const idMatch = fullUrl.match(/\/(\d{5,})\/?(?:[?#]|$)/);
    const id = idMatch ? idMatch[1] : null;

    // Location extraction
    const locMatch = rowHtml.match(/class="[^"]*jobLocation[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const location = locMatch ? decodeHtml(locMatch[1].replace(/<[^>]+>/g, "")) : "India";

    // Posted date extraction
    const dateMatch = rowHtml.match(/class="[^"]*jobDate[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    let posted_at = null;
    if (dateMatch) {
      const rawDate = decodeHtml(dateMatch[1].replace(/<[^>]+>/g, ""));
      const m = rawDate.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
      if (m) {
        const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
        const mon = months[m[1].slice(0, 3).toLowerCase()] || "01";
        const day = m[2].padStart(2, "0");
        const year = m[3];
        posted_at = `${year}-${mon}-${day}T00:00:00.000Z`;
      } else {
        const parsedDate = new Date(rawDate);
        if (Number.isFinite(parsedDate.getTime())) posted_at = parsedDate.toISOString();
      }
    }

    // Department extraction
    const deptMatch = rowHtml.match(/class="[^"]*jobDepartment[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const department = deptMatch ? decodeHtml(deptMatch[1].replace(/<[^>]+>/g, "")) : "";

    jobs.push({
      id,
      title,
      location,
      url: fullUrl,
      posted_at,
      department
    });
  }

  return jobs;
}

export default {
  id: "successfactors",
  type: "employer_careers",

  async fetchJobs(companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "SAP", host: "jobs.sap.com" };
    const domain = company.host || company.domain_host || (typeof company.domain === "string" && company.domain.includes(".") ? company.domain : "jobs.sap.com");
    const locationQuery = company.locationQuery || "India";
    const maxPages = company.maxPages || 30;
    const pageSize = company.pageSize || 25;
    const seenKeys = new Set();
    const allJobs = [];

    try {
      for (let page = 0; page < maxPages; page++) {
        const startrow = page * pageSize;
        const searchPath = `/search/?q=&locationsearch=${encodeURIComponent(locationQuery)}&startrow=${startrow}`;
        const url = `https://${domain}${searchPath}`;

        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          if (page === 0) {
            return { jobs: [], err: `HTTP ${res.status} from ${domain}` };
          }
          break;
        }

        const html = await res.text();
        const pageJobs = parseSuccessFactorsCards(html, domain);
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

        if (newJobsOnPage === 0) break;
        if (pageJobs.length < pageSize) break;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const title = rawJob.title || "Software Developer";
    const location = rawJob.location || "India";
    const domain = company.host || company.domain_host || (typeof company.domain === "string" && company.domain.includes(".") ? company.domain : "jobs.sap.com");
    const applyUrl = rawJob.url || `https://${domain}`;
    const isRemote = /remote|virtual/i.test(title) || /remote/i.test(location);
    const posted_at = rawJob.posted_at || null;
    const department = rawJob.department || "";
    const snippet = `${title} - ${location}${rawJob.id ? ` [Req: ${rawJob.id}]` : ""}`.trim();

    return {
      source: "successfactors",
      source_type: "employer_careers",
      company: company.name || "SAP",
      tier: company.tier || "1",
      priority: company.priority || "GO",
      title,
      location,
      url: applyUrl,
      posted_at,
      department,
      remote: isRemote,
      snippet,
      _experienceText: `${title}\nCompany: ${company.name}\nDepartment: ${department}\nLocation: ${location}`.slice(0, 5000)
    };
  }
};

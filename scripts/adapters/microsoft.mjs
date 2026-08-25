/**
 * scripts/adapters/microsoft.mjs — Microsoft Careers Public REST API Adapter
 * 
 * Source: Microsoft Global Career Search Services (apply.careers.microsoft.com)
 * Endpoint: GET https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&location=India&start=${start}
 * 
 * Features:
 * - Direct public unauthenticated JSON API
 * - Full pagination support across India requisitions
 * - Standardized location normalization (Bengaluru, Hyderabad, Noida, Gurugram, Mumbai)
 * - Deterministic requisition IDs & stable canonical application URLs
 * - Zero LLM tokens. Zero browser automation. Clean JSON responses.
 * - Source Type: employer_careers / direct_ats
 */

function parseMicrosoftDate(raw) {
  const ts = raw.postedTs || raw.creationTs;
  if (!ts) return null;
  const num = Number(ts);
  if (!Number.isFinite(num) || num <= 0) return null;
  const ms = num < 100_000_000_000 ? num * 1000 : num;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeLocations(rawJob) {
  if (Array.isArray(rawJob.standardizedLocations) && rawJob.standardizedLocations.length > 0) {
    const locs = rawJob.standardizedLocations
      .map(l => l.replace(/, [A-Z]{2}, IN$/, ", India").replace(/^IN$/, "India"))
      .filter(Boolean);
    if (locs.length > 0) return locs.join("; ");
  }

  if (Array.isArray(rawJob.locations) && rawJob.locations.length > 0) {
    const locs = rawJob.locations.filter(Boolean);
    if (locs.length > 0) return locs.join("; ");
  }

  if (typeof rawJob.location === "string" && rawJob.location.trim()) {
    return rawJob.location.trim();
  }

  return "India";
}

export default {
  id: "microsoft",
  type: "direct_ats",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { name: "Microsoft" };
    const host = company.host || "apply.careers.microsoft.com";
    const domain = company.domain_host || (company.domain && company.domain.includes(".") ? company.domain : "microsoft.com");
    const locationQuery = company.locationQuery || "India";
    const allJobs = [];
    const maxPages = company.maxPages || 30;

    let start = 0;
    let total = Infinity;

    try {
      for (let page = 0; page < maxPages; page++) {
        const url = `https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}&location=${encodeURIComponent(locationQuery)}&start=${start}`;

        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": `https://${host}/careers?location=${encodeURIComponent(locationQuery)}&hl=en`
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          if (page === 0) {
            return { jobs: [], err: `HTTP ${res.status} ${res.statusText} from Microsoft Careers` };
          }
          break;
        }

        const data = await res.json();
        const positions = Array.isArray(data?.data?.positions) ? data.data.positions : [];
        if (positions.length === 0) break;

        allJobs.push(...positions);
        if (typeof data?.data?.count === "number") {
          total = data.data.count;
        }

        start += positions.length;
        if (start >= total) break;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const title = rawJob.name || "Software Engineer";
    const primaryId = rawJob.id || rawJob.displayJobId;
    const applyUrl = primaryId 
      ? `https://apply.careers.microsoft.com/careers/job/${primaryId}?hl=en` 
      : (company.careers_url || "https://careers.microsoft.com");

    const locList = normalizeLocations(rawJob);
    const posted_at = parseMicrosoftDate(rawJob);
    const department = rawJob.department || "Software Engineering";
    const isRemote = /remote|virtual/i.test(title) || /remote/i.test(locList) || rawJob.workLocationOption === "remote";
    const snippet = `${title} - ${locList} (${posted_at ? posted_at.slice(0, 10) : "Active"})`.trim();

    return {
      source: "microsoft",
      source_type: "employer_careers",
      company: company.name || "Microsoft",
      tier: company.tier || "0",
      priority: company.priority || "GO",
      title,
      location: locList,
      url: applyUrl,
      posted_at,
      department,
      remote: isRemote,
      snippet,
      _experienceText: `${title}\nDepartment: ${department}\nLocation: ${locList}`.slice(0, 5000)
    };
  }
};

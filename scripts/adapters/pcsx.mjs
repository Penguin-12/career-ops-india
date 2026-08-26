/**
 * scripts/adapters/pcsx.mjs — Generic Eightfold PCSX Public Search API Adapter
 * 
 * Transport: Eightfold Candidate Exchange / Career Search Service (PCSX)
 * Endpoint: GET https://${host}/api/pcsx/search?domain=${domain}&location=${locationQuery}&start=${start}
 * 
 * Features:
 * - Generic, unauthenticated public REST API across Eightfold PCSX-powered employers
 * - Verified across Microsoft, Qualcomm, Micron, Morgan Stanley, and Vodafone
 * - Deterministic deduplication by primary requisition/position ID
 * - Dynamic canonical apply URL reconstruction: https://${host}${positionUrl}
 * - Robust timestamp parsing (seconds and milliseconds Unix timestamps)
 * - Standardized multi-location normalization
 * - Complete catalog crawl with server metadata-driven termination
 * - Zero LLM tokens. Zero browser automation. Clean JSON responses.
 * - Source Type: employer_careers / direct_ats
 */

function parsePcsxDate(raw) {
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
      .map(l => typeof l === "string" ? l.replace(/, [A-Z]{2}, IN$/, ", India").replace(/^IN$/, "India") : "")
      .filter(Boolean);
    if (locs.length > 0) return locs.join("; ");
  }

  if (Array.isArray(rawJob.locations) && rawJob.locations.length > 0) {
    const locs = rawJob.locations.map(l => typeof l === "string" ? l.trim() : "").filter(Boolean);
    if (locs.length > 0) return locs.join("; ");
  }

  if (typeof rawJob.location === "string" && rawJob.location.trim()) {
    return rawJob.location.trim();
  }

  return "India";
}

function resolveApplyUrl(rawJob, company, primaryId) {
  const host = company.host || "apply.careers.microsoft.com";
  if (rawJob.positionUrl && typeof rawJob.positionUrl === "string") {
    if (rawJob.positionUrl.startsWith("http")) {
      return rawJob.positionUrl;
    }
    const pathSegment = rawJob.positionUrl.startsWith("/") ? rawJob.positionUrl : `/${rawJob.positionUrl}`;
    const sep = pathSegment.includes("?") ? "&" : "?";
    return `https://${host}${pathSegment}${pathSegment.includes("hl=") ? "" : `${sep}hl=en`}`;
  }

  if (primaryId) {
    return `https://${host}/careers/job/${primaryId}?hl=en`;
  }

  return company.careers_url || `https://${host}`;
}

export default {
  id: "pcsx",
  type: "direct_ats",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { name: "Microsoft", host: "apply.careers.microsoft.com", domain: "microsoft.com" };
    const host = company.host || "apply.careers.microsoft.com";
    const domain = company.domain_host || (company.domain && company.domain.includes(".") ? company.domain : "microsoft.com");
    const locationQuery = company.locationQuery || "India";
    const allJobs = [];
    const seenIds = new Set();
    const maxPages = company.maxPages || 100; // Safety cap (up to ~1,000+ postings)

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
          signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
          if (page === 0) {
            return { jobs: [], err: `HTTP ${res.status} ${res.statusText} from ${host}` };
          }
          break;
        }

        const data = await res.json();
        const positions = Array.isArray(data?.data?.positions) ? data.data.positions : [];
        if (positions.length === 0) break;

        for (const pos of positions) {
          const id = String(pos.id || pos.displayJobId || pos.atsJobId || JSON.stringify(pos));
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allJobs.push(pos);
          }
        }

        const reportedTotal = typeof data?.data?.total === "number" ? data.data.total : data?.data?.count;
        if (typeof reportedTotal === "number") {
          total = reportedTotal;
        }

        start += positions.length;
        if (start >= total || positions.length < 5) break;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const companyObj = typeof company === "object" ? company : { name: company || "Unknown" };
    const title = (rawJob.name || "Software Engineer").trim();
    const primaryId = rawJob.id || rawJob.displayJobId || rawJob.atsJobId;
    const applyUrl = resolveApplyUrl(rawJob, companyObj, primaryId);

    const locList = normalizeLocations(rawJob);
    const posted_at = parsePcsxDate(rawJob);
    const department = rawJob.department || "Software Engineering";
    const isRemote = /remote|virtual/i.test(title) || /remote/i.test(locList) || rawJob.workLocationOption === "remote";
    const snippet = `${title} - ${locList} (${posted_at ? posted_at.slice(0, 10) : "Active"})`.trim();

    return {
      source: companyObj.source || "pcsx",
      source_type: "employer_careers",
      company: companyObj.name || "Unknown",
      tier: companyObj.tier || "0",
      priority: companyObj.priority || "GO",
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

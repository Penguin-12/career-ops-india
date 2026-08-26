/**
 * scripts/adapters/rippling.mjs — Generic Rippling ATS Public REST API Adapter
 * 
 * Transport: Rippling ATS Public Job Board API (v2)
 * Endpoint: GET https://ats.rippling.com/api/v2/board/${slug}/jobs?page=${page}&pageSize=100
 * 
 * Features:
 * - Public unauthenticated JSON API
 * - Server metadata-driven pagination (totalPages, pageSize, totalItems)
 * - Deterministic deduplication by job ID
 * - Structured multi-location normalization and country filtering (IN/India)
 * - Zero LLM tokens. Zero browser automation. Clean JSON responses.
 * - Source Type: employer_careers / direct_ats
 */

function isIndiaLocation(loc) {
  if (!loc) return false;
  if (typeof loc === "string") {
    const s = loc.toLowerCase();
    if (s.includes("indiana") || s.includes("indianapolis")) return false;
    return /india|\bin\b|bengaluru|bangalore|hyderabad|gurgaon|gurugram|noida|mumbai|pune|chennai|delhi|gift city/i.test(s);
  }
  if (typeof loc === "object") {
    if (loc.countryCode === "IN" || loc.country === "India") return true;
    const name = `${loc.name || ""} ${loc.city || ""} ${loc.state || ""}`.toLowerCase();
    if (name.includes("indiana") || name.includes("indianapolis")) return false;
    return /india|\bin\b|bengaluru|bangalore|hyderabad|gurgaon|gurugram|noida|mumbai|pune|chennai|delhi|gift city/i.test(name);
  }
  return false;
}

function normalizeLocations(rawJob) {
  if (Array.isArray(rawJob.locations) && rawJob.locations.length > 0) {
    const locNames = rawJob.locations
      .map(l => {
        if (typeof l === "string") return l.trim();
        if (l && typeof l === "object") {
          return l.name || `${l.city || ""}${l.country ? `, ${l.country}` : ""}`.trim();
        }
        return "";
      })
      .filter(Boolean);
    if (locNames.length > 0) return locNames.join("; ");
  }

  if (typeof rawJob.location === "string" && rawJob.location.trim()) {
    return rawJob.location.trim();
  }

  return "India";
}

function parseRipplingDate(rawJob) {
  const ts = rawJob.createdAt || rawJob.updatedAt || rawJob.postedAt || rawJob.publishedAt;
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default {
  id: "rippling",
  type: "direct_ats",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { slug: slugOrCompany };
    const slug = company.slug || "rippling";
    const allJobs = [];
    const seenIds = new Set();
    const maxPages = company.maxPages || 50;

    let page = 1;
    let totalPages = 1;

    try {
      while (page <= totalPages && page <= maxPages) {
        const url = `https://ats.rippling.com/api/v2/board/${encodeURIComponent(slug)}/jobs?page=${page}&pageSize=100`;

        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "application/json"
          },
          signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
          if (page === 1) {
            return { jobs: [], err: `HTTP ${res.status} ${res.statusText} from Rippling ATS (${slug})` };
          }
          break;
        }

        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length === 0) break;

        if (typeof data?.totalPages === "number" && data.totalPages > 0) {
          totalPages = data.totalPages;
        }

        for (const item of items) {
          const id = String(item.id || item.uuid || JSON.stringify(item));
          if (!seenIds.has(id)) {
            seenIds.add(id);
            // Filter to India jobs before returning or let normalizer/scanner handle
            const hasIndia = Array.isArray(item.locations) 
              ? item.locations.some(isIndiaLocation) 
              : isIndiaLocation(item.location) || isIndiaLocation(item.name);
            if (hasIndia) {
              allJobs.push(item);
            }
          }
        }

        page++;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const companyObj = typeof company === "object" ? company : { name: company || "Rippling" };
    const slug = companyObj.slug || "rippling";
    const title = (rawJob.name || rawJob.title || "Software Engineer").trim();
    const primaryId = rawJob.id || rawJob.uuid;
    const applyUrl = rawJob.url || (primaryId ? `https://ats.rippling.com/${slug}/jobs/${primaryId}` : (companyObj.careers_url || "https://www.rippling.com/careers"));

    const locList = normalizeLocations(rawJob);
    const posted_at = parseRipplingDate(rawJob);
    const department = rawJob.department?.name || (typeof rawJob.department === "string" ? rawJob.department : "Engineering");
    const isRemote = rawJob.workplaceType === "REMOTE" || /remote/i.test(title) || /remote/i.test(locList);
    const snippet = `${title} - ${locList} (${posted_at ? posted_at.slice(0, 10) : "Active"})`.trim();

    return {
      source: "rippling",
      source_type: "employer_careers",
      company: companyObj.name || "Rippling",
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


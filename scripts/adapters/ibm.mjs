/**
 * scripts/adapters/ibm.mjs — IBM Careers Public Search API Adapter
 * 
 * Target: IBM Global Careers Search (careers.ibm.com / www.ibm.com/careers)
 * Endpoint: GET https://www-api.ibm.com/search/api/v1/ibmcom/appid/careers/responseFormat/json
 * 
 * Features:
 * - Public unauthenticated search API powered by IBM search services
 * - Query scope `careers2` with India location matching
 * - Structured extraction of title, canonical URL, job ID, location, department, and posted date
 * - Robust fallback mapping across docattributes key-value pairs
 * - Zero LLM tokens. Zero browser automation.
 */

export function extractDocAttributes(docattributes = []) {
  const map = {};
  if (Array.isArray(docattributes)) {
    for (const attr of docattributes) {
      if (attr && typeof attr === "object") {
        Object.assign(map, attr);
      }
    }
  }
  return map;
}

export function normalizeIbmHit(item, company = { name: "IBM" }) {
  const rawItem = item || {};
  const attrMap = extractDocAttributes(rawItem.docattributes);

  const title = rawItem.title || rawItem.highlightedtext?.title || "Software Engineer";
  const rawUrl = rawItem.url || rawItem.highlightedtext?.url || "";
  
  // Job ID / Requisition ID extraction from URL or attributes
  let jobId = null;
  const urlIdMatch = rawUrl.match(/jobId=(\d+)/i) || rawUrl.match(/\/(\d{5,})\/?(?:[?#]|$)/);
  if (urlIdMatch) {
    jobId = urlIdMatch[1];
  } else if (rawItem.id && typeof rawItem.id === "string" && !/^[0-9a-f]{32,}$/i.test(rawItem.id)) {
    jobId = rawItem.id;
  }

  const applyUrl = rawUrl.startsWith("http") 
    ? rawUrl 
    : (jobId ? `https://careers.ibm.com/careers/JobDetail?jobId=${jobId}` : "https://careers.ibm.com");

  // Location extraction: field_keyword_19 is specific city/state (e.g. Bangalore, IN), field_keyword_05 is country
  const location = attrMap.field_keyword_19 || attrMap.field_keyword_05 || "India";
  const department = attrMap.field_keyword_08 || "Software Engineering";
  
  // Date extraction
  let posted_at = null;
  if (attrMap.dcdate) {
    const dMatch = attrMap.dcdate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dMatch) {
      posted_at = `${dMatch[1]}-${dMatch[2]}-${dMatch[3]}T00:00:00.000Z`;
    }
  }

  const isRemote = /remote/i.test(attrMap.field_keyword_17 || "") || /remote/i.test(title) || /remote/i.test(location);
  const snippet = `${title} - ${location}${jobId ? ` [Req: ${jobId}]` : ""}`.trim();

  return {
    source: "ibm",
    source_type: "employer_careers",
    company: company.name || "IBM",
    tier: company.tier || "1",
    priority: company.priority || "GO",
    title,
    location,
    url: applyUrl,
    posted_at,
    department,
    remote: isRemote,
    snippet,
    _experienceText: `${title}\nCompany: ${company.name || "IBM"}\nDepartment: ${department}\nLocation: ${location}\n${rawItem.description || ""}`.slice(0, 5000)
  };
}

export default {
  id: "ibm",
  type: "employer_careers",

  async fetchJobs(companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "IBM" };
    const locationQuery = company.locationQuery || "India";
    const maxPages = company.maxPages || 30;
    const pageSize = company.pageSize || 50;
    const seenKeys = new Set();
    const allJobs = [];

    try {
      for (let page = 0; page < maxPages; page++) {
        const from = page * pageSize;
        const searchUrl = `https://www-api.ibm.com/search/api/v1/ibmcom/appid/careers/responseFormat/json?scope=careers2&rmdt=ALL&appid=careers&query=${encodeURIComponent(locationQuery)}&fr=${from}&nr=${pageSize}`;

        const res = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "application/json"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          if (page === 0) {
            return { jobs: [], err: `HTTP ${res.status} from IBM Search API` };
          }
          break;
        }

        const data = await res.json();
        const searchResults = data?.resultset?.searchresults;
        const list = Array.isArray(searchResults?.searchresultlist) ? searchResults.searchresultlist : [];
        if (list.length === 0) break;

        let newJobsOnPage = 0;
        for (const item of list) {
          const key = item.url || item.id || item.title;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allJobs.push(item);
            newJobsOnPage++;
          }
        }

        if (newJobsOnPage === 0) break;

        const total = typeof searchResults?.totalresults === "number" ? searchResults.totalresults : 0;
        if (from + list.length >= total) break;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    return normalizeIbmHit(rawJob, company);
  }
};

/**
 * scripts/adapters/google.mjs — Google Careers SSR Adapter
 * 
 * Source: Google Careers (https://www.google.com/about/careers/applications/jobs/results/?location=India)
 * 
 * Features:
 * - Direct HTTP GET of Google Careers India application results
 * - Extracts structured AF_initDataCallback (ds:1) embedded application state
 * - Zero LLM tokens. Zero browser automation. Clean SSR payload extraction.
 * - Source Type: employer_careers
 */

function parseGoogleTimestamp(tsArray) {
  if (Array.isArray(tsArray) && typeof tsArray[0] === "number") {
    return new Date(tsArray[0] * 1000).toISOString();
  }
  return null;
}

export default {
  id: "google",
  type: "direct_careers",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { name: "Google" };
    const allJobs = [];
    const MAX_PAGES = 3;

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://www.google.com/about/careers/applications/jobs/results/?location=India&page=${page}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          if (page === 1) return { jobs: [], err: `HTTP ${res.status} ${res.statusText} from Google Careers` };
          break;
        }

        const html = await res.text();
        const matches = [...html.matchAll(/AF_initDataCallback\(([\s\S]*?)\);/g)];
        let ds1Match = null;
        for (const m of matches) {
          if (m[1].includes("'ds:1'") || m[1].includes('"ds:1"')) {
            ds1Match = m[1];
            break;
          }
        }

        if (!ds1Match) {
          if (page === 1) return { jobs: [], err: "Could not find AF_initDataCallback (ds:1) in Google response" };
          break;
        }

        let obj;
        try {
          const fn = Function(`"use strict"; return (${ds1Match});`);
          obj = fn();
        } catch (e) {
          if (page === 1) return { jobs: [], err: `Malformed Google payload: ${e.message}` };
          break;
        }

        const postings = Array.isArray(obj?.data?.[0]) ? obj.data[0] : [];
        if (postings.length === 0) break;

        allJobs.push(...postings);

        // If fewer than 20 postings on page, reached the end
        if (postings.length < 20) break;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const id = rawJob[0] || "";
    const title = rawJob[1] || "";
    const applyUrl = rawJob[2] 
      ? rawJob[2].replace(/&amp;/g, "&") 
      : (id ? `https://www.google.com/about/careers/applications/jobs/results/${id}` : (company.careers_url || "https://careers.google.com"));

    const responsibilities = Array.isArray(rawJob[3]) 
      ? rawJob[3].filter(Boolean).map(x => Array.isArray(x) ? x[1] : x).join(" ") 
      : (typeof rawJob[3] === "string" ? rawJob[3] : "");

    const qualifications = Array.isArray(rawJob[4]) 
      ? rawJob[4].filter(Boolean).map(x => Array.isArray(x) ? x[1] : x).join(" ") 
      : (typeof rawJob[4] === "string" ? rawJob[4] : "");

    const locArr = rawJob[9] || [];
    const location = (locArr[0] && locArr[0][0]) ? locArr[0][0] : "India";

    const descArr = rawJob[10] || [];
    const description = (descArr[0] && descArr[0][1]) ? descArr[0][1] : (typeof descArr[1] === "string" ? descArr[1] : "");

    const posted_at = parseGoogleTimestamp(rawJob[12]);

    const cleanResp = responsibilities.replace(/<[^>]+>/g, " ");
    const cleanQual = qualifications.replace(/<[^>]+>/g, " ");
    const cleanDesc = description.replace(/<[^>]+>/g, " ");

    const isRemote = /remote|virtual/i.test(title) || /remote/i.test(location);

    return {
      source: "google",
      source_type: "employer_careers",
      company: company.name || "Google",
      tier: company.tier || "0",
      priority: company.priority || "GO",
      title,
      location,
      url: applyUrl,
      posted_at,
      department: "Engineering",
      remote: isRemote,
      snippet: `${title} - ${location} (${posted_at ? posted_at.slice(0, 10) : "Active"})`.trim(),
      _experienceText: `${title}\n${location}\n${cleanQual}\n${cleanResp}\n${cleanDesc}`.slice(0, 5000)
    };
  }
};

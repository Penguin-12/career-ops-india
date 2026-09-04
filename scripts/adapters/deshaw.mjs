/**
 * scripts/adapters/deshaw.mjs — D.E. Shaw India Careers Next.js Adapter
 * 
 * Source: D.E. Shaw India (https://www.deshawindia.com/careers)
 * 
 * Features:
 * - Direct HTTP GET of Next.js server-rendered application
 * - Extracts props.pageProps.regularJobs from __NEXT_DATA__
 * - Zero LLM tokens. Zero browser automation. Clean Next.js state extraction.
 * - Source Type: employer_careers
 */

import { fetchWithRetry } from "./http.mjs";

export default {
  id: "deshaw",
  type: "direct_careers",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { name: "D.E. Shaw" };
    const url = company.careers_url || "https://www.deshawindia.com/careers";

    try {
      const res = await fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      }, { maxRetries: 5, timeoutMs: 20000 });

      if (!res.ok) {
        return { jobs: [], err: `HTTP ${res.status} ${res.statusText} from D.E. Shaw` };
      }

      const html = await res.text();
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!match) {
        return { jobs: [], err: "Could not find __NEXT_DATA__ in D.E. Shaw response" };
      }

      let nextData;
      try {
        nextData = JSON.parse(match[1]);
      } catch (e) {
        return { jobs: [], err: `Malformed D.E. Shaw __NEXT_DATA__: ${e.message}` };
      }

      const regularJobs = nextData.props?.pageProps?.regularJobs;
      if (!Array.isArray(regularJobs)) {
        return { jobs: [], err: "props.pageProps.regularJobs is missing or not an array" };
      }

      return { jobs: regularJobs };
    } catch (err) {
      return { jobs: [], err: err.message };
    }
  },

  normalize(rawJob, company) {
    const jobData = rawJob.data || {};
    const title = rawJob.displayName || jobData.displayName || "";
    
    // Extract office locations (e.g. Hyderabad, Bengaluru, Gurugram)
    const offices = Array.isArray(rawJob.office) 
      ? rawJob.office.map(o => o.name || o.abbreviation).filter(Boolean) 
      : [];
    const location = offices.length > 0 ? `${offices.join(", ")}, India` : "India";

    const jobSlug = jobData.jobUrl || "";
    const url = jobSlug 
      ? `https://www.deshawindia.com/careers/${jobSlug}` 
      : (company.careers_url || "https://www.deshawindia.com/careers");

    const header = Array.isArray(rawJob.header) ? rawJob.header.join(", ") : (rawJob.header || "");
    const category = Array.isArray(rawJob.category) ? rawJob.category.join(", ") : (rawJob.category || "");
    const department = header || category || jobData.department?.name || "Quantitative Tech / Software";

    const desc = jobData.jobDescription || {};
    const websiteDesc = (desc.websiteDescription || "").replace(/<[^>]+>/g, " ");
    const resp = (desc.responsibilitiesHtml || desc.responsibilities || "").replace(/<[^>]+>/g, " ");
    const people = (desc.peopleWeAreLookingForHtml || desc.peopleWeAreLookingFor || desc.peopleWeAreLookingForStr || "").replace(/<[^>]+>/g, " ");

    const isRemote = /remote/i.test(title) || /remote/i.test(location);

    return {
      source: "deshaw",
      source_type: "employer_careers",
      company: company.name || "D.E. Shaw",
      tier: company.tier || "0",
      priority: company.priority || "GO",
      title,
      location,
      url,
      posted_at: null, // D.E. Shaw does not expose posted timestamps on regularJobs
      department,
      remote: isRemote,
      snippet: `${title} - ${location} (${department})`.trim(),
      _experienceText: `${title}\n${location}\n${department}\n${websiteDesc}\n${resp}\n${people}`.slice(0, 5000)
    };
  }
};


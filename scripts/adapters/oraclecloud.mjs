/**
 * scripts/adapters/oraclecloud.mjs — Generic Oracle Cloud HCM ATS Adapter
 * 
 * Target Tenants:
 * - JPMorgan Chase (jpmc.fa.oraclecloud.com)
 * - Goldman Sachs (hdpc.fa.us2.oraclecloud.com)
 * 
 * Endpoint:
 * GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder={finder};siteNumber={site},keyword={keyword},offset={offset},limit={limit}
 * 
 * Features:
 * - Configuration-driven, supporting multiple tenants
 * - Safe pagination via finder offset/limit
 * - Zero LLM tokens. Zero scraping. Fast JSON responses.
 * - Source Type: employer_ats
 */

function parseOracleDate(dateStr) {
  if (!dateStr) return null;
  const parsed = Date.parse(dateStr);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export default {
  id: "oraclecloud",
  type: "direct_ats",

  async fetchJobs(slugOrCompany) {
    const company = typeof slugOrCompany === "object" ? slugOrCompany : { host: slugOrCompany, site: "CX_1001" };
    const host = company.host;
    if (!host) {
      return { jobs: [], err: `Missing host for Oracle Cloud tenant: ${company.name || "unknown"}` };
    }

    const site = company.site || "CX_1001";
    const finder = company.finder || "findReqs";
    const keywords = Array.isArray(company.keywords) 
      ? company.keywords 
      : (company.keyword ? [company.keyword, "Bengaluru", "Hyderabad"] : ["India", "Bengaluru", "Hyderabad"]);
    const PAGE_SIZE = 50;

    const seenIds = new Set();
    const allJobs = [];

    try {
      for (const kw of keywords) {
        let finderStr = `${finder};siteNumber=${site},offset=0,limit=${PAGE_SIZE}`;
        if (kw) {
          finderStr += `,keyword=${encodeURIComponent(kw)}`;
        }

        const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${finderStr}`;

        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "User-Agent": "career-ops-india/1.2"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          if (allJobs.length === 0) {
            return { jobs: [], err: `HTTP ${res.status} ${res.statusText} from ${host}` };
          }
          continue;
        }

        const data = await res.json();
        const firstItem = data.items?.[0];
        if (!firstItem) continue;

        const postings = Array.isArray(firstItem.requisitionList) ? firstItem.requisitionList : [];
        for (const p of postings) {
          const id = p.Id || `${p.Title}|${p.PrimaryLocation}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allJobs.push(p);
          }
        }
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const title = rawJob.Title || "";
    const location = rawJob.PrimaryLocation || "India";
    const id = rawJob.Id || "";
    const host = company.host || "oraclecloud.com";
    const site = company.site || "CX_1001";
    const url = id 
      ? `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/requisitions/preview/${id}` 
      : (company.careers_url || `https://${host}`);
    
    const posted_at = parseOracleDate(rawJob.PostedDate);
    const department = rawJob.JobFamily || rawJob.JobFunction || rawJob.Department || rawJob.Organization || "";
    const isRemote = /remote|virtual/i.test(rawJob.WorkplaceType || rawJob.PrimaryLocation || "") || /remote/i.test(title);

    const qualifications = (rawJob.ExternalQualificationsStr || "").replace(/<[^>]+>/g, " ");
    const responsibilities = (rawJob.ExternalResponsibilitiesStr || "").replace(/<[^>]+>/g, " ");
    const description = (rawJob.ShortDescriptionStr || "").replace(/<[^>]+>/g, " ");

    return {
      source: "oraclecloud",
      source_type: "employer_ats",
      company: company.name || "Oracle Cloud Employer",
      tier: company.tier || "0",
      priority: company.priority || "GO",
      title,
      location,
      url,
      posted_at,
      department,
      remote: isRemote,
      snippet: `${title} - ${location} (${rawJob.PostedDate || "Active"})`.trim(),
      _experienceText: `${title}\n${location}\n${department}\n${responsibilities}\n${qualifications}\n${description}`.slice(0, 5000)
    };
  }
};

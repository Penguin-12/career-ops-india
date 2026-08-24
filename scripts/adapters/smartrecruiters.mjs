/**
 * scripts/adapters/smartrecruiters.mjs — SmartRecruiters ATS adapter
 * 
 * Public API:
 *   GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?country=in&limit=100
 * 
 * Zero LLM tokens. Zero scraping. Clean JSON responses.
 */

export default {
  id: "smartrecruiters",
  type: "direct_ats",

  async fetchJobs(slug) {
    try {
      // First try fetching India postings specifically
      let url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings?country=in&limit=100`;
      let res = await fetch(url, {
        headers: { "Accept": "application/json", "User-Agent": "career-ops-india/1.2" },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { jobs: [], err: `HTTP ${res.status} ${res.statusText}` };
      }

      let data = await res.json();
      let jobs = Array.isArray(data.content) ? data.content : [];

      // If no India-specific postings found, fallback to general company postings
      if (jobs.length === 0 && data.totalFound === 0) {
        url = `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`;
        res = await fetch(url, {
          headers: { "Accept": "application/json", "User-Agent": "career-ops-india/1.2" },
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          data = await res.json();
          jobs = Array.isArray(data.content) ? data.content : [];
        }
      }

      return { jobs };
    } catch (err) {
      return { jobs: [], err: err.message };
    }
  },

  normalize(rawJob, company) {
    const locParts = [
      rawJob.location?.city,
      rawJob.location?.region,
      rawJob.location?.country === "in" ? "India" : rawJob.location?.country
    ].filter(Boolean);

    const location = locParts.join(", ") || (rawJob.location?.remote ? "Remote" : "India");
    const url = `https://jobs.smartrecruiters.com/${company.slug}/${rawJob.id}`;
    const expLabel = rawJob.experienceLevel?.label || "";
    const typeOfEmp = rawJob.typeOfEmployment?.label || "";

    return {
      source: "smartrecruiters",
      company: company.name,
      tier: company.tier || "2",
      title: rawJob.name || "",
      location,
      url,
      posted_at: rawJob.releasedDate || null,
      department: rawJob.department?.label || rawJob.function?.label || "Engineering",
      remote: Boolean(rawJob.location?.remote),
      snippet: `${rawJob.name} - ${expLabel} ${typeOfEmp}`.trim(),
      _experienceText: `${expLabel}\n${rawJob.name}`
    };
  }
};

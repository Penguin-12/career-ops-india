/**
 * scripts/adapters/phonepe.mjs — PhonePe Careers API Adapter
 * 
 * Target: PhonePe (https://www.phonepe.com/careers/)
 * Endpoint: GET https://www.phonepe.com/apollo/job-postings/latest.json
 * 
 * Features:
 * - Direct public JSON feed published by PhonePe's career infrastructure
 * - Deterministic extraction of active published jobs, locations, and SmartRecruiters apply URLs
 * - Zero LLM tokens. Zero browser automation. Clean JSON responses.
 * - Source Type: employer_careers
 */

function parsePhonePeDate(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/\d+/);
  if (match) {
    const ms = parseInt(match[0], 10);
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(dateStr);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default {
  id: "phonepe",
  type: "employer_careers",

  async fetchJobs(companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "PhonePe" };
    const endpoint = company.endpoint || "https://www.phonepe.com/apollo/job-postings/latest.json";

    try {
      const res = await fetch(endpoint, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        return { jobs: [], err: `HTTP ${res.status} from PhonePe careers endpoint` };
      }

      const data = await res.json();
      const rawList = Array.isArray(data.results) ? data.results : [];
      const activeJobs = rawList.filter(j => j.status !== "NOT_PUBLISHED" && j.applyUrl);

      return { jobs: activeJobs };
    } catch (err) {
      return { jobs: [], err: err.message };
    }
  },

  normalize(rawJob, companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "PhonePe" };
    const title = rawJob.title || "Software Engineer";
    const location = rawJob.location || "Bengaluru";
    const url = rawJob.applyUrl || "https://www.phonepe.com/careers/";
    const department = rawJob.department || "";

    const idMatch = url.match(/PHONEPELIMITED\/([0-9a-zA-Z]+)/);
    const source_job_id = idMatch ? idMatch[1] : (rawJob.id || url.split("/").pop());
    const posted_at = parsePhonePeDate(rawJob.updatedAt);
    const isRemote = /remote|virtual/i.test(location) || /remote/i.test(title);

    return {
      source: "phonepe",
      source_type: "employer_careers",
      company: company.name || "PhonePe",
      tier: company.tier || "1",
      priority: company.priority || "GO",
      title,
      location,
      url,
      source_job_id,
      posted_at,
      department,
      remote: isRemote,
      snippet: `${title} - ${location} (${department})`.trim(),
      _experienceText: `${title}\nPhonePe\n${location}\n${department}`.slice(0, 5000)
    };
  }
};

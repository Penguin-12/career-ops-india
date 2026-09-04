/**
 * scripts/adapters/turbohire.mjs — Generic TurboHire ATS REST API Adapter
 * 
 * Target Employers:
 * - Flipkart (flipkart.turbohire.co / 4d757ba0-3d57-448a-b82c-238ed87ac90f)
 * 
 * Transport: TurboHire Public Career API
 * Endpoints:
 * 1. GET https://api.turbohire.co/api/token/noauth (Token exchange)
 * 2. POST https://api.turbohire.co/api/careerpagev2/filteredjobs?orgId={orgId}&pageType=custom
 * 
 * Features:
 * - Public token-based REST API with zero browser automation
 * - Canonical location and job reference parsing
 * - Zero LLM tokens. Fast JSON responses.
 * - Source Type: employer_ats
 */

import { fetchWithRetry } from "./http.mjs";

function parseLocation(locRaw) {
  if (!locRaw) return "India";
  try {
    const parsed = JSON.parse(locRaw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const addresses = parsed.map(l => l.Address).filter(Boolean);
      if (addresses.length > 0) return addresses.join("; ");
    }
  } catch {}
  return String(locRaw);
}

function parseTurboHireDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default {
  id: "turbohire",
  type: "direct_ats",

  async fetchJobs(companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "TurboHire Employer" };
    const orgId = company.orgId || company.slug || company.careerpageId;
    const host = company.host || `${company.slug || "flipkart"}.turbohire.co`;

    if (!orgId) {
      return { jobs: [], err: `Missing orgId/careerpageId for TurboHire tenant: ${company.name || "unknown"}` };
    }

    try {
      // 1. Authenticate with noauth token endpoint
      const tokenRes = await fetchWithRetry("https://api.turbohire.co/api/token/noauth", {
        headers: {
          "Origin": `https://${host}`,
          "Referer": `https://${host}/`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      }, { maxRetries: 5, timeoutMs: 20000 });

      if (!tokenRes.ok) {
        return { jobs: [], err: `HTTP ${tokenRes.status} during TurboHire token acquisition for ${host}` };
      }

      const tokenData = await tokenRes.json();
      const token = tokenData.access_token;

      if (!token) {
        return { jobs: [], err: `No access_token returned by TurboHire for ${host}` };
      }

      // 2. Fetch all public filtered jobs
      const pageType = company.pageType || "custom";
      const jobsRes = await fetchWithRetry(`https://api.turbohire.co/api/careerpagev2/filteredjobs?orgId=${orgId}&pageType=${pageType}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Origin": `https://${host}`,
          "Referer": `https://${host}/`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*"
        },
        body: JSON.stringify({
          careerpageId: orgId,
          pageSize: company.pageSize || 200,
          pageIndex: 0
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!jobsRes.ok) {
        return { jobs: [], err: `HTTP ${jobsRes.status} from TurboHire filteredjobs for ${host}` };
      }

      const jobsData = await jobsRes.json();
      const rawList = Array.isArray(jobsData.Result) ? jobsData.Result : [];

      return { jobs: rawList };
    } catch (err) {
      return { jobs: [], err: err.message };
    }
  },

  normalize(rawJob, companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "TurboHire Employer" };
    const host = company.host || `${company.slug || "flipkart"}.turbohire.co`;
    
    const title = rawJob.JobTitle || "Role";
    const location = parseLocation(rawJob.Location);
    const department = rawJob.Department || "";
    const jobId = rawJob.JobIdObfuscated || rawJob.JobId;
    const url = jobId ? `https://${host}/job/${jobId}` : (company.careers_url || `https://${host}`);
    const posted_at = parseTurboHireDate(rawJob.PublishedDate || rawJob.UpdatedDate);
    const isRemote = /remote|virtual/i.test(location) || /remote/i.test(title);
    const source_job_id = rawJob.JobCode || rawJob.JobId || jobId;

    return {
      source: "turbohire",
      source_type: "employer_ats",
      company: company.name || "Flipkart",
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
      _experienceText: `${title}\n${company.name || "Flipkart"}\n${location}\n${department}\nJob Code: ${source_job_id}`.slice(0, 5000)
    };
  }
};

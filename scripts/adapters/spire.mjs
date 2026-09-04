/**
 * scripts/adapters/spire.mjs — Spire.AI / Spire2Grow Career Portal Adapter
 * 
 * Target Employers:
 * - Myntra (jobs.myntra.com / MYNTRA-93as3)
 * 
 * Transport: Spire.AI Public Requisition Search REST API
 * Endpoint:
 * 1. GET https://io.spire2grow.com/ies/v1/p/workspaceId?domain={domain} (Dynamic Workspace Discovery)
 * 2. GET https://io.spire2grow.com/ies/v1/p/requisition/_search?workspaceId={workspaceId}&page={page}&size={size}
 * 
 * Features:
 * - Zero browser automation, fast direct REST API
 * - Automatic workspace resolution and fallback
 * - Source Type: employer_ats
 */

function parseLocation(rawLoc) {
  if (!rawLoc) return "India";
  if (Array.isArray(rawLoc)) {
    return rawLoc.map(l => (typeof l === "object" ? (l.city || l.name || l.location) : l)).filter(Boolean).join("; ") || "India";
  }
  if (typeof rawLoc === "object") {
    return rawLoc.city || rawLoc.location || rawLoc.name || "India";
  }
  return String(rawLoc);
}

function parseSpireDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default {
  id: "spire",
  type: "direct_ats",

  async fetchJobs(companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "Spire Employer" };
    const domain = company.domain || company.host || "jobs.myntra.com";
    let workspaceId = company.workspaceId;

    try {
      // 1. Resolve workspaceId if not provided
      if (!workspaceId) {
        const wsRes = await fetch(`https://io.spire2grow.com/ies/v1/p/workspaceId?domain=${domain}`, {
          headers: {
            "Origin": `https://${domain}`,
            "Referer": `https://${domain}/`,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "*/*"
          },
          signal: AbortSignal.timeout(6000)
        });

        if (wsRes.ok) {
          const wsText = (await wsRes.text()).trim();
          if (wsText && !wsText.startsWith("<") && !wsText.startsWith("{")) {
            workspaceId = wsText;
          }
        }
      }

      workspaceId = workspaceId || "MYNTRA-93as3";

      // 2. Fetch public requisitions
      const searchUrl = `https://io.spire2grow.com/ies/v1/p/requisition/_search?workspaceId=${workspaceId}&page=1&size=100`;
      const res = await fetch(searchUrl, {
        headers: {
          "WorkspaceId": workspaceId,
          "workspaceId": workspaceId,
          "Origin": `https://${domain}`,
          "Referer": `https://${domain}/`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        return { jobs: [], err: `HTTP ${res.status} from Spire requisition search for ${domain}` };
      }

      const data = await res.json();
      const rawList = Array.isArray(data.entities)
        ? data.entities
        : (Array.isArray(data.requisitions) ? data.requisitions : (Array.isArray(data) ? data : []));

      return { jobs: rawList };
    } catch (err) {
      return { jobs: [], err: err.message };
    }
  },

  normalize(rawJob, companyConfig) {
    const company = typeof companyConfig === "object" ? companyConfig : { name: "Myntra" };
    const domain = company.domain || company.host || "jobs.myntra.com";
    
    const title = rawJob.jobTitle || rawJob.title || rawJob.role || "Role";
    const location = parseLocation(rawJob.location || rawJob.locations || rawJob.cityName || rawJob.city);
    const department = rawJob.departmentName || rawJob.department || "";
    const displayId = rawJob.displayId || rawJob.requisitionId || rawJob.id;
    const url = displayId ? `https://${domain}/#/jobDetail/${displayId}` : (company.careers_url || `https://${domain}`);
    const posted_at = parseSpireDate(rawJob.publishedDate || rawJob.createdDate || rawJob.postedDate);
    const isRemote = /remote|virtual/i.test(location) || /remote/i.test(title);
    const description = rawJob.jobDescription || rawJob.description || "";

    return {
      source: "spire",
      source_type: "employer_ats",
      company: company.name || "Myntra",
      tier: company.tier || "1",
      priority: company.priority || "GO",
      title,
      location,
      url,
      source_job_id: displayId,
      posted_at,
      department,
      remote: isRemote,
      snippet: `${title} - ${location} (${department})`.trim(),
      _experienceText: `${title}\n${company.name || "Myntra"}\n${location}\n${department}\n${description}`.slice(0, 5000)
    };
  }
};

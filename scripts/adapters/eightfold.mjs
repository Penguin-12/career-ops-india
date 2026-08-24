/**
 * scripts/adapters/eightfold.mjs — Generic Eightfold ATS Adapter
 * 
 * Reusable across companies utilizing Eightfold Talent Intelligence / PCSX API
 * (e.g. Microsoft, Morgan Stanley, Qualcomm).
 */

function resolveTenant(company) {
  return company.tenant || company.slug || company.name.toLowerCase().replace(/\s+/g, "");
}

function resolveDomain(company) {
  if (company.domain) return company.domain;
  const tenant = resolveTenant(company);
  return `${tenant}.com`;
}

function parseEightfoldTimestamp(ts) {
  if (!ts) return null;
  const num = Number(ts);
  if (!Number.isFinite(num) || num <= 0) return null;
  const ms = num < 100_000_000_000 ? num * 1000 : num;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export default {
  async fetchJobs(company) {
    const tenant = resolveTenant(company);
    const domain = resolveDomain(company);
    const host = company.host || `${tenant}.eightfold.ai`;
    const allJobs = [];

    try {
      let start = 0;
      const num = company.pageSize || 50;
      const maxPages = company.maxPages || 20;

      for (let page = 0; page < maxPages; page++) {
        const url = `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&start=${start}&num=${num}&location=${encodeURIComponent(company.locationQuery || "India")}&pid=${company.pid || ""}`;
        
        const res = await fetch(url, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) {
          break;
        }

        const data = await res.json();
        const positions = Array.isArray(data.positions) ? data.positions : [];
        if (positions.length === 0) break;

        allJobs.push(...positions);
        const total = typeof data.count === "number" ? data.count : allJobs.length;
        start += positions.length;

        if (start >= total || positions.length < num) break;
      }

      return { jobs: allJobs };
    } catch (err) {
      return { jobs: allJobs, err: err.message };
    }
  },

  normalize(rawJob, company) {
    const tenant = resolveTenant(company);
    const domain = resolveDomain(company);
    const host = company.host || `${tenant}.eightfold.ai`;
    const id = rawJob.id || rawJob.jobId || rawJob.displayJobId || "";

    const url = rawJob.canonicalUrl || `https://${host}/careers/job/${id}`;
    const apply_url = id ? `https://${host}/careers/apply?pid=${id}&domain=${domain}` : null;

    let loc = "";
    if (Array.isArray(rawJob.locations) && rawJob.locations.length > 0) {
      loc = rawJob.locations.join("; ");
    } else if (typeof rawJob.locations === "string") {
      loc = rawJob.locations;
    } else if (rawJob.location) {
      loc = typeof rawJob.location === "string" ? rawJob.location : (rawJob.location.city || rawJob.location.country || "");
    }

    const title = rawJob.name || rawJob.title || "";
    const posted_at = parseEightfoldTimestamp(rawJob.postedTs) || parseEightfoldTimestamp(rawJob.creationTs);
    const department = rawJob.department || rawJob.businessUnit || "";
    const isRemote = /remote|wfh/i.test(loc) || /remote/i.test(title);

    return {
      source: "eightfold",
      source_type: "employer_ats",
      company: company.name,
      tier: company.tier || "0",
      priority: company.priority || "GO",
      title,
      location: loc || "India",
      url,
      apply_url,
      posted_at,
      department,
      remote: isRemote,
      snippet: `${title} - ${loc || "India"}`.trim(),
      _experienceText: `${title}\n${loc}\n${department}\n${rawJob.jobDescription || ""}`
    };
  }
};

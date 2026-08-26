export default {
  id: "ashby",
  type: "direct_ats",
  fetchJobs: async (slugOrCompany) => {
    const slug = typeof slugOrCompany === "object" ? slugOrCompany.slug : slugOrCompany;
    try {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        { headers: { "User-Agent": "career-ops-india/1.0", "Accept": "application/json" },
          signal: AbortSignal.timeout(12000) });
      if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
      const d = await res.json();
      return { jobs: d.jobs || d.jobPostings || [] };
    } catch(e) { return { jobs: [], err: e.message }; }
  },
  normalize: (j, co) => {
    const loc = j.location || j.locationName || j.jobPostingLocations?.[0]?.locationName || "";
    const content = j.descriptionHtml || j.descriptionPlain || "";
    const primaryId = j.id || j.jobId;
    return {
      source: "ashby",
      company: co.name,
      tier: co.tier || "2",
      title: (j.title || "").trim(),
      location: loc,
      url: j.jobUrl || (co.slug && primaryId ? `https://jobs.ashbyhq.com/${co.slug}/${primaryId}` : `https://jobs.ashbyhq.com/${co.slug || ""}`),
      posted_at: j.publishedAt || j.postedAt || null,
      department: j.departmentName || (typeof j.department === "string" ? j.department : ""),
      remote: loc.toLowerCase().includes("remote"),
      snippet: content.replace(/<[^>]*>/g, " ").slice(0, 300),
      _experienceText: content.replace(/<[^>]*>/g, " ")
    };
  }
};

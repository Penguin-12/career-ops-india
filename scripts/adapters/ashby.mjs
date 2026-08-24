export default {
  id: "ashby",
  type: "direct_ats",
  fetchJobs: async (slug) => {
    try {
      const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        { headers: { "User-Agent": "career-ops-india/1.0", "Accept": "application/json" },
          signal: AbortSignal.timeout(12000) });
      if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
      const d = await res.json();
      return { jobs: d.jobPostings || [] };
    } catch(e) { return { jobs: [], err: e.message }; }
  },
  normalize: (j, co) => {
    const loc = j.locationName||j.jobPostingLocations?.[0]?.locationName||"";
    return { source:"ashby", company:co.name, tier:co.tier||"2",
      title:j.title||"", location:loc,
      url:`https://jobs.ashbyhq.com/${co.slug}/${j.id}`,
      posted_at:j.publishedAt||null, department:j.departmentName||"",
      remote:loc.toLowerCase().includes("remote"),
      snippet:(j.descriptionHtml||"").replace(/<[^>]*>/g," ").slice(0,300),
      _experienceText:(j.descriptionHtml||"").replace(/<[^>]*>/g," ") };
  }
};

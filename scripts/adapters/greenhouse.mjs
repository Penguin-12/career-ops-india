export default {
  id: "greenhouse",
  type: "direct_ats",
  fetchJobs: async (slug) => {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
        { headers: { "User-Agent": "career-ops-india/1.0" }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
      const d = await res.json();
      return { jobs: d.jobs || [] };
    } catch(e) { return { jobs: [], err: e.message }; }
  },
  normalize: (j, co) => {
    return { source:"greenhouse", company:co.name, tier:co.tier||"2",
      title:j.title||"", location:j.location?.name||"",
      url:j.absolute_url||`https://boards.greenhouse.io/${co.slug}/jobs/${j.id}`,
      posted_at:j.first_published||j.updated_at||null, department:j.departments?.[0]?.name||"",
      remote:(j.location?.name||"").toLowerCase().includes("remote"),
      snippet:(j.content||"").replace(/<[^>]*>/g," ").slice(0,300),
      _experienceText:(j.content||"").replace(/<[^>]*>/g," ") };
  }
};

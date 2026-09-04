import { fetchWithRetry } from "./http.mjs";

export default {
  id: "lever",
  type: "direct_ats",
  fetchJobs: async (slug) => {
    try {
      const res = await fetchWithRetry(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" }
      }, { maxRetries: 5, timeoutMs: 20000 });
      if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
      const d = await res.json();
      return { jobs: Array.isArray(d) ? d : [] };
    } catch(e) { return { jobs: [], err: e.message }; }
  },
  normalize: (j, co) => {
    const loc = j.categories?.location || j.workplaceType || "";
    return { source:"lever", company:co.name, tier:co.tier||"2",
      title:j.text||"", location:loc,
      url:j.hostedUrl||j.applyUrl||"",
      posted_at:j.createdAt ? new Date(j.createdAt).toISOString() : null,
      department:j.categories?.department||"",
      remote:loc.toLowerCase().includes("remote"),
      snippet:(j.descriptionPlain||"").slice(0,300),
      _experienceText:j.descriptionPlain||"" };
  }
};

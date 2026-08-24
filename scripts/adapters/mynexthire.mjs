/**
 * scripts/adapters/mynexthire.mjs — MyNextHire ATS adapter
 * 
 * Fetches public job postings from MyNextHire REST endpoint.
 * Zero scraping, zero auth, clean JSON response.
 */

export default {
  id: "mynexthire",
  type: "direct_ats",
  fetchJobs: async (slug) => {
    try {
      const res = await fetch(`https://${slug}.mynexthire.com/employer/careers/reqlist/get`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "career-ops-india/1.0"
        },
        body: JSON.stringify({ source: "careers" }),
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return { jobs: [], err: `HTTP ${res.status}` };
      const d = await res.json();
      return { jobs: Array.isArray(d.reqDetailsBOList) ? d.reqDetailsBOList : [] };
    } catch(e) {
      return { jobs: [], err: e.message };
    }
  },
  normalize: (j, co) => {
    const loc = j.location || j.locationAddress || "";
    const expMin = Number.isFinite(j.expMin) ? j.expMin : 0;
    const expMax = Number.isFinite(j.expMax) ? j.expMax : expMin;
    const expText = `${expMin}-${expMax} years \n ${j.jdDisplay || ""}`;
    const cleanSnippet = (j.jdDisplay || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

    return {
      source: "mynexthire",
      company: co.name,
      tier: co.tier || "2",
      title: j.reqTitle || j.designation || "",
      location: loc,
      url: `https://careers.${co.slug}.com/#/jobs/${j.reqId}`,
      posted_at: j.approvedOn ? new Date(j.approvedOn).toISOString() : null,
      department: j.buName || j.careerStream || "",
      remote: loc.toLowerCase().includes("remote"),
      snippet: cleanSnippet,
      _experienceText: expText
    };
  }
};

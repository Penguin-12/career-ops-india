import assert from "node:assert";
import radancyAdapter, { parseRadancyCards } from "../scripts/adapters/radancy.mjs";
import { isHardwareSiliconExclusion } from "../scripts/scan.mjs";

console.log("=== Radancy / TalentBrew Adapter Test Suite ===");

// 1. Barclays HTML Fixture Test
console.log("\n[Test 1] Barclays fixture parsing");
{
  const barclaysHtml = `
    <ul class="search-results-list" data-total-pages="37">
      <li>
        <a href="/job/pune/senior-software-engineer-c-sharp/2257/99689890224" data-job-id="99689890224">
          <h2>Senior Software Engineer – C# &amp; Cloud</h2>
          <span class="job-location">Pune, Maharashtra, India</span>
          <span class="job-date-posted">08/20/2026</span>
        </a>
      </li>
      <li>
        <a href="/job/bengaluru/lead-platform-engineer/2257/99689890225" data-job-id="99689890225">
          <h2>Lead Platform Engineer &#x2013; Distributed Systems</h2>
          <span class="job-location">Bengaluru, Karnataka, India</span>
        </a>
      </li>
    </ul>
  `;

  const parsed = parseRadancyCards(barclaysHtml, "search.jobs.barclays");
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].id, "99689890224");
  assert.strictEqual(parsed[0].title, "Senior Software Engineer – C# & Cloud");
  assert.strictEqual(parsed[0].location, "Pune, Maharashtra, India");
  assert.strictEqual(parsed[0].url, "https://search.jobs.barclays/job/pune/senior-software-engineer-c-sharp/2257/99689890224");
  assert.ok(parsed[0].posted_at.startsWith("2026-08-20"));

  assert.strictEqual(parsed[1].id, "99689890225");
  assert.strictEqual(parsed[1].title, "Lead Platform Engineer – Distributed Systems");
  assert.strictEqual(parsed[1].location, "Bengaluru, Karnataka, India");
  assert.strictEqual(parsed[1].url, "https://search.jobs.barclays/job/bengaluru/lead-platform-engineer/2257/99689890225");
  console.log("  ✅ Passed: Barclays fixture parsed with correct title, decoded entities, job ID, and canonical URL");
}

// 2. Capital One HTML Fixture Test (multi-line layout without <h2> tag)
console.log("\n[Test 2] Capital One fixture parsing (card text fallback)");
{
  const capOneHtml = `
    <div class="search-results">
      <a href="/job/bengaluru/senior-associate-software-engineer/1732/99711345360" data-job-id="99711345360">
        99711345360
        08/24/2026
        Senior Associate, Software Engineer - Cloud Platform
        Bengaluru, Karnataka
      </a>
    </div>
  `;

  const parsed = parseRadancyCards(capOneHtml, "www.capitalonecareers.com");
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].id, "99711345360");
  assert.strictEqual(parsed[0].title, "Senior Associate, Software Engineer - Cloud Platform");
  assert.strictEqual(parsed[0].location, "Bengaluru, Karnataka");
  assert.strictEqual(parsed[0].url, "https://www.capitalonecareers.com/job/bengaluru/senior-associate-software-engineer/1732/99711345360");
  console.log("  ✅ Passed: Capital One fixture parsed correctly using text line fallback and date/id exclusion");
}

// 3. Optum (UnitedHealth Group) Fixture Test
console.log("\n[Test 3] Optum (UHG) fixture parsing");
{
  const optumHtml = `
    <section id="search-results-list" data-total-pages="18">
      <a href="/job/gurugram/software-engineering-specialist/34088/99705613216" data-job-id="99705613216">
        <h3>Software Engineering Specialist</h3>
        <span class="job-location">Gurugram, Haryana, India</span>
        <span class="job-date-posted">08/25/2026</span>
      </a>
    </section>
  `;

  const parsed = parseRadancyCards(optumHtml, "careers.unitedhealthgroup.com");
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].id, "99705613216");
  assert.strictEqual(parsed[0].title, "Software Engineering Specialist");
  assert.strictEqual(parsed[0].location, "Gurugram, Haryana, India");
  assert.strictEqual(parsed[0].url, "https://careers.unitedhealthgroup.com/job/gurugram/software-engineering-specialist/34088/99705613216");
  console.log("  ✅ Passed: Optum fixture parsed with <h3> title tag and UHG canonical domain");
}

// 4. Arm / Palo Alto Networks URL Prefix and Job ID fallback
console.log("\n[Test 4] Path prefix and URL-derived job ID extraction");
{
  const panHtml = `
    <div>
      <a href="/en/job/bengaluru/senior-cloud-security-engineer/25217/99657854416">
        <h2>Senior Cloud Security Engineer</h2>
        <span class="location">Bangalore, India</span>
      </a>
    </div>
  `;

  const parsed = parseRadancyCards(panHtml, "jobs.paloaltonetworks.com", "en/");
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].id, "99657854416");
  assert.strictEqual(parsed[0].title, "Senior Cloud Security Engineer");
  assert.strictEqual(parsed[0].location, "Bangalore, India");
  assert.strictEqual(parsed[0].url, "https://jobs.paloaltonetworks.com/en/job/bengaluru/senior-cloud-security-engineer/25217/99657854416");
  console.log("  ✅ Passed: Fallback job ID successfully derived from URL path when data-job-id attribute is absent");
}

// 5. Normalization contract & hardware exclusion preservation
console.log("\n[Test 5] Normalization contract & hardware exclusion preservation");
{
  const rawJob = {
    id: "99677618096",
    title: "Principal Observability Engineer",
    location: "Bengaluru, India",
    url: "https://careers.arm.com/job/bengaluru/principal-observability-engineer/14468/99677618096",
    posted_at: "2026-08-25T00:00:00.000Z"
  };

  const norm = radancyAdapter.normalize(rawJob, {
    name: "Arm",
    tier: "1",
    priority: "GO",
    domain: "careers.arm.com"
  });

  assert.strictEqual(norm.source, "radancy");
  assert.strictEqual(norm.source_type, "employer_careers");
  assert.strictEqual(norm.company, "Arm");
  assert.strictEqual(norm.tier, "1");
  assert.strictEqual(norm.priority, "GO");
  assert.strictEqual(norm.title, "Principal Observability Engineer");
  assert.strictEqual(norm.url, rawJob.url);
  assert.strictEqual(isHardwareSiliconExclusion(norm.title), false);

  // Arm Hardware job should be caught by taxonomy
  assert.strictEqual(isHardwareSiliconExclusion("Senior Silicon Design Engineer"), true);
  assert.strictEqual(isHardwareSiliconExclusion("DFT Engineer"), true);
  console.log("  ✅ Passed: Normalized job conforms to schema and taxonomy correctly filters hardware/silicon vs software");
}

// 6. Malformed & empty resilience
console.log("\n[Test 6] Malformed HTML resilience");
{
  assert.deepStrictEqual(parseRadancyCards("", "example.com"), []);
  assert.deepStrictEqual(parseRadancyCards("<div>no links here</div>", "example.com"), []);
  assert.deepStrictEqual(parseRadancyCards(null, "example.com"), []);
  console.log("  ✅ Passed: Empty and malformed HTML safely returns empty array without throwing");
}

console.log("\n========================================================");
console.log("🎉 ALL RADANCY ADAPTER TESTS PASSED!");
console.log("========================================================");

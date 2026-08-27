import assert from "node:assert";
import successFactorsAdapter, { parseSuccessFactorsCards } from "../scripts/adapters/successfactors.mjs";
import { isHardwareSiliconExclusion } from "../scripts/taxonomy.mjs";

console.log("=== SAP SuccessFactors CSB Adapter Test Suite ===");

// 1. SuccessFactors HTML Table Fixture Test
console.log("\n[Test 1] SAP SuccessFactors table row parsing");
{
  const sfHtml = `
    <table id="searchresults">
      <tbody>
        <tr class="data-row">
          <td class="colTitle">
            <a class="jobTitle-link" href="/job/Bangalore-Full-Stack-Java-AI-Developer-SAP-LABS-%28-4-to-8-Years-%29-560066/1429157633/">
              Full Stack Java AI Developer : SAP LABS ( 4 to 8 Years )
            </a>
          </td>
          <td class="colLocation">
            <span class="jobLocation">Bangalore, IN, 560066</span>
          </td>
          <td class="colDepartment">
            <span class="jobDepartment">Software-Design and Development</span>
          </td>
          <td class="colDate">
            <span class="jobDate">Aug 24, 2026</span>
          </td>
        </tr>
        <tr class="data-row">
          <td class="colTitle">
            <a class="jobTitle-link" href="/job/Gurgaon-Senior-Cloud-Engineer/1428549333/">
              Senior Cloud Infrastructure Engineer
            </a>
          </td>
          <td class="colLocation">
            <span class="jobLocation">Gurgaon, Haryana, India</span>
          </td>
        </tr>
      </tbody>
    </table>
  `;

  const parsed = parseSuccessFactorsCards(sfHtml, "jobs.sap.com");
  assert.strictEqual(parsed.length, 2);
  
  assert.strictEqual(parsed[0].id, "1429157633");
  assert.strictEqual(parsed[0].title, "Full Stack Java AI Developer : SAP LABS ( 4 to 8 Years )");
  assert.strictEqual(parsed[0].location, "Bangalore, IN, 560066");
  assert.strictEqual(parsed[0].url, "https://jobs.sap.com/job/Bangalore-Full-Stack-Java-AI-Developer-SAP-LABS-%28-4-to-8-Years-%29-560066/1429157633/");
  assert.strictEqual(parsed[0].department, "Software-Design and Development");
  assert.ok(parsed[0].posted_at.startsWith("2026-08-24"));

  assert.strictEqual(parsed[1].id, "1428549333");
  assert.strictEqual(parsed[1].title, "Senior Cloud Infrastructure Engineer");
  assert.strictEqual(parsed[1].location, "Gurgaon, Haryana, India");
  assert.strictEqual(parsed[1].url, "https://jobs.sap.com/job/Gurgaon-Senior-Cloud-Engineer/1428549333/");
  assert.strictEqual(parsed[1].posted_at, null);
  console.log("  ✅ Passed: SuccessFactors rows parsed with job ID, title, location, and canonical URL");
}

// 2. Normalization contract & taxonomy check
console.log("\n[Test 2] Normalization contract & software taxonomy");
{
  const rawJob = {
    id: "1429157633",
    title: "Full Stack Java AI Developer : SAP LABS",
    location: "Bangalore, IN, 560066",
    url: "https://jobs.sap.com/job/Bangalore-Full-Stack-Java-AI-Developer-SAP-LABS-560066/1429157633/",
    posted_at: "2026-08-24T00:00:00.000Z",
    department: "Software-Design and Development"
  };

  const norm = successFactorsAdapter.normalize(rawJob, {
    name: "SAP",
    tier: "1",
    priority: "GO",
    domain: "jobs.sap.com"
  });

  assert.strictEqual(norm.source, "successfactors");
  assert.strictEqual(norm.source_type, "employer_careers");
  assert.strictEqual(norm.company, "SAP");
  assert.strictEqual(norm.tier, "1");
  assert.strictEqual(norm.priority, "GO");
  assert.strictEqual(norm.title, "Full Stack Java AI Developer : SAP LABS");
  assert.strictEqual(norm.url, rawJob.url);
  assert.strictEqual(isHardwareSiliconExclusion(norm.title), false);
  console.log("  ✅ Passed: Normalized job conforms to schema and is recognized as software engineering");
}

// 3. Malformed and empty resilience
console.log("\n[Test 3] Malformed HTML resilience");
{
  assert.deepStrictEqual(parseSuccessFactorsCards("", "jobs.sap.com"), []);
  assert.deepStrictEqual(parseSuccessFactorsCards("<div>no rows</div>", "jobs.sap.com"), []);
  assert.deepStrictEqual(parseSuccessFactorsCards(null, "jobs.sap.com"), []);
  console.log("  ✅ Passed: Empty and malformed HTML safely returns empty array without throwing");
}

console.log("\n========================================================");
console.log("🎉 ALL SUCCESSFACTORS ADAPTER TESTS PASSED!");
console.log("========================================================");


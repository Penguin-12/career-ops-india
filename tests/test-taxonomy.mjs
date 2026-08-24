#!/usr/bin/env node
/**
 * tests/test-taxonomy.mjs — Comprehensive Semantic Precedence Regression Suite
 */

import assert from "assert";

const ROLE_FAMILY_PATTERNS = [
  // 1. Non-Technical / Management / Product / Program / Writing (Hard Exclusions)
  {
    family: "non_technical",
    pattern: /\b(technical writer|writer|documentation|product owner|product manager|technical product manager|program manager|technical program manager|tpm\b|project manager|scrum master|agile coach|sales|marketing|growth|content|video|finance|accounting|controller|equity research|portfolio specialist|hr\b|human resources|recruiter|talent|facilities|warehouse|fleet|category|cx\b|customer experience|client servicing|account executive|account manager|business development|bd\b|legal|counsel|procurement|strategist|transformation owner|bdr\b|executive assistant|advisory|risk analytics|rcsa|strategy)\b/i
  },
  // 2. QA / SDET / IT Helpdesk
  {
    family: "qa_sdet",
    pattern: /\b(qa\b|quality assurance|sdet|test engineer|software engineer in test|automation test|test automation|it helpdesk|tech support)\b/i
  },
  // 3. Consulting / Solutions / Customer Success
  {
    family: "consulting_solutions",
    pattern: /\b(consultant|technical consultant|solutions consultant|implementation consultant|solutions architect|presales|sales engineer|customer success engineer|customer engineer|technical solutions engineer)\b/i
  },
  // 4. BI & Analytics
  {
    family: "data_engineering",
    pattern: /\b(business intelligence engineer|bi engineer|bie\b|bi developer|tableau developer|power bi|looker developer)\b/i
  },
  // 5. Application Support / RPA
  {
    family: "application_support",
    pattern: /\b(application engineer|support engineer|customer engineer|tech support engineer|field engineer|implementation engineer|production support|rpa engineer|uipath|robotic process automation)\b/i
  },
  // 6. Specialized Engineering
  {
    family: "ai_ml",
    pattern: /\b(machine learning|ml engineer|ai engineer|ai agent|applied ai|nlp engineer|llm engineer|deep learning|computer vision|genai|agentic ai)\b/i
  },
  {
    family: "data_science",
    pattern: /\b(data scientist|decision scientist|applied scientist|quantitative researcher|statistician)\b/i
  },
  {
    family: "data_engineering",
    pattern: /\b(data engineer|big data engineer|data platform engineer|etl engineer|analytics engineer|data pipeline|database engineer)\b/i
  },
  {
    family: "security",
    pattern: /\b(security engineer|appsec|application security|cloud security|infosec|information security|product security|security operations|incident response|soc analyst|iam engineer|threat|vulnerability|compliance & security)\b/i
  },
  {
    family: "distributed_systems",
    pattern: /\b(distributed systems?|messaging platform|event driven|kafka|stream processing|consensus)\b/i
  },
  {
    family: "backend",
    pattern: /\b(backend|back[- ]?end|server[- ]?side|api engineer|microservices)\b/i
  },
  {
    family: "platform_infra",
    pattern: /\b(platform engineer|infrastructure engineer|infra engineer|cloud engineer|sre\b|site reliability|devops|kubernetes|observability|cloud network|systems engineer|system development engineer|sysde|platform)\b/i
  },
  {
    family: "fullstack",
    pattern: /\b(full[\s-]?stack|frontend and backend|ui\/api|fullstack)\b/i
  },
  {
    family: "frontend",
    pattern: /\b(frontend|front[- ]?end|ui engineer|web developer|react developer|angular developer)\b/i
  },
  {
    family: "mobile",
    pattern: /\b(android|ios\b|react[\s-]?native|flutter|mobile development|mobile engineer|mobile developer|\bmobile\s+(?:app|application|client|frontend|software|sde|engineer|dev\b|developer)\b|\([^)]*mobile[^)]*\)|[-–—,:]\s*mobile\b|\bmobile\b)/i
  },
  {
    family: "general_sde",
    pattern: /\b(software development engineer|software engineer|sde\b|software dev|developer|mts\b|member of technical staff)\b/i
  }
];

const SENIORITY_PATTERNS = [
  { seniority: "manager", pattern: /\b(manager|engineering manager|sdm\b|software development manager|director|vp\b|vice president|head of|chief|cto)\b/i },
  { seniority: "principal", pattern: /\b(principal|distinguished|fellow)\b/i },
  { seniority: "staff", pattern: /\b(staff)\b/i },
  { seniority: "lead", pattern: /\b(lead|tech lead|team lead|architect)\b/i },
  { seniority: "senior", pattern: /\b(senior|sr\.?)\b/i },
  { seniority: "sde_3", pattern: /\b(sde\s*iii\b|sde\s*3\b|software engineer\s*3\b|software engineer\s*iii\b|engineer\s*iii\b|engineer\s*3\b|mts\s*3\b|l3\b)\b/i },
  { seniority: "sde_2", pattern: /\b(sde\s*ii\b|sde\s*2\b|software engineer\s*2\b|software engineer\s*ii\b|engineer\s*ii\b|engineer\s*2\b|intermediate|l2\b|mid)\b/i },
  { seniority: "sde_1", pattern: /\b(sde\s*i\b|sde\s*1\b|software engineer\s*1\b|software engineer\s*i\b|engineer\s*i\b|engineer\s*1\b|junior|associate|entry|l1\b|grad|graduate)\b/i },
  { seniority: "intern", pattern: /\b(intern|internship|co-op|apprentice|apprenticeship|trainee)\b/i }
];

function detectRoleFamily(title, department = "", text = "") {
  const normTitle = String(title || "").trim();
  for (const { family, pattern } of ROLE_FAMILY_PATTERNS) {
    if (pattern.test(normTitle)) return family;
  }
  const normDept = String(department || "").trim();
  if (normDept) {
    for (const { family, pattern } of ROLE_FAMILY_PATTERNS) {
      if (pattern.test(normDept)) return family;
    }
  }
  if (/\b(engineer|developer|mts|tech|member technical staff)\b/i.test(normTitle)) {
    const contextualSnippet = `${normTitle} ${normDept} ${text.slice(0, 1000)}`;
    for (const { family, pattern } of ROLE_FAMILY_PATTERNS) {
      if (["non_technical", "qa_sdet", "consulting_solutions", "application_support"].includes(family)) continue;
      if (family === "ai_ml") {
        if (/\b(machine learning|deep learning|llm|nlp|agentic|genai)\b/i.test(contextualSnippet)) return "ai_ml";
      } else if (pattern.test(contextualSnippet)) {
        return family;
      }
    }
    return "general_sde";
  }
  return "unknown";
}

function detectJobSeniority(title) {
  const normTitle = String(title || "").trim();
  for (const { seniority, pattern } of SENIORITY_PATTERNS) {
    if (pattern.test(normTitle)) return seniority;
  }
  return "unknown";
}

function detectCareerAlignment(roleFamily, title = "") {
  const normTitle = String(title || "").toLowerCase();
  if (/\b(business intelligence|bi engineer|bie\b|bi developer|tableau|looker)\b/i.test(normTitle)) {
    return "low";
  }
  if (["backend", "distributed_systems", "platform_infra", "ai_ml", "fullstack"].includes(roleFamily)) {
    return "very_high";
  }
  if (roleFamily === "general_sde") {
    return "high";
  }
  if (["data_engineering", "security"].includes(roleFamily)) {
    return "medium";
  }
  return "low";
}

const auditTestCases = [
  { title: "Machine Learning Engineer, Amazon Music", expFamily: "ai_ml", expSen: "unknown", expAlign: "very_high" },
  { title: "Security Engineer, Incident Response", expFamily: "security", expSen: "unknown", expAlign: "medium" },
  { title: "Software Development Engineer II, Payments", expFamily: "general_sde", expSen: "sde_2", expAlign: "high" },
  { title: "Senior Engineer, Messaging Platform", expFamily: "distributed_systems", expSen: "senior", expAlign: "very_high" },
  { title: "AI Agent Engineer", expFamily: "ai_ml", expSen: "unknown", expAlign: "very_high" },
  { title: "Data Scientist", expFamily: "data_science", expSen: "unknown", expAlign: "low" },
  { title: "Backend Engineer", expFamily: "backend", expSen: "unknown", expAlign: "very_high" },
  { title: "Fullstack Engineer", expFamily: "fullstack", expSen: "unknown", expAlign: "very_high" },
  { title: "Sales Manager", expFamily: "non_technical", expSen: "manager", expAlign: "low" },
  { title: "Application Engineer III, B2B Payments", expFamily: "application_support", expSen: "sde_3", expAlign: "low" },
  { title: "Business Intelligence Engineer I, Risk and Compliance Solutions (RCS)", expFamily: "data_engineering", expSen: "sde_1", expAlign: "low" },
  { title: "Senior Product Owner - BESS and Data Platform", expFamily: "non_technical", expSen: "senior", expAlign: "low" },
  { title: "Senior Technical Consultant - Salesforce DevOps", expFamily: "consulting_solutions", expSen: "senior", expAlign: "low" },
  { title: "System Development Engineer II, Time & Pay Innovation", expFamily: "platform_infra", expSen: "sde_2", expAlign: "very_high" },
  { title: "Technical Program Manager, AI Platform", expFamily: "non_technical", expSen: "manager", expAlign: "low" },
  { title: "Customer Success Engineer, Cloud", expFamily: "consulting_solutions", expSen: "unknown", expAlign: "low" },
  { title: "RPA Engineer, UiPath", expFamily: "application_support", expSen: "unknown", expAlign: "low" },
  { title: "Staff Technical Writer", expFamily: "non_technical", expSen: "staff", expAlign: "low" },
  // Mobile disambiguation test cases
  { title: "Software Development Engineer II (Mobile Development)", expFamily: "mobile", expSen: "sde_2", expAlign: "low" },
  { title: "Senior Software Engineer, Android", expFamily: "mobile", expSen: "senior", expAlign: "low" },
  { title: "SDE II - iOS", expFamily: "mobile", expSen: "sde_2", expAlign: "low" },
  { title: "Software Engineer - React Native", expFamily: "mobile", expSen: "unknown", expAlign: "low" },
  { title: "Backend Engineer - Mobile API Platform", expFamily: "backend", expSen: "unknown", expAlign: "very_high" },
  { title: "Software Development Engineer II (Mobile development), Amazon Cross Border Tech", expFamily: "mobile", expSen: "sde_2", expAlign: "low" }
];

console.log("=== Running Semantic Precedence Regression Suite ===");
let passedCount = 0;
for (const tc of auditTestCases) {
  const fam = detectRoleFamily(tc.title);
  const sen = detectJobSeniority(tc.title);
  const align = detectCareerAlignment(fam, tc.title);
  assert.strictEqual(fam, tc.expFamily, `Family mismatch for "${tc.title}" (got ${fam}, expected ${tc.expFamily})`);
  assert.strictEqual(sen, tc.expSen, `Seniority mismatch for "${tc.title}" (got ${sen}, expected ${tc.expSen})`);
  assert.strictEqual(align, tc.expAlign, `Alignment mismatch for "${tc.title}" (got ${align}, expected ${tc.expAlign})`);
  console.log(`✅ Passed: "${tc.title}" -> [${fam}] [${sen}] [${align}]`);
  passedCount++;
}

import { isHardwareSiliconExclusion } from "../scripts/scan.mjs";

console.log("\n=== Running Hardware, Silicon & DFT Exclusion Regression Suite ===");
const hardwareTestCases = [
  // Hardware & Silicon Exclusions (Must be rejected)
  { title: "Silicon Formal Verification Engineer III", shouldExclude: true },
  { title: "Senior Silicon Digital Design Engineer", shouldExclude: true },
  { title: "Silicon Validation Engineer", shouldExclude: true },
  { title: "Senior AI/ML Hardware Architect", shouldExclude: true },
  { title: "Silicon Chip Lead, Google Cloud", shouldExclude: true },
  { title: "Digital Design Engineer", shouldExclude: true },
  { title: "Hardware Design Engineer", shouldExclude: true },
  { title: "Physical Design Engineer", shouldExclude: true },
  { title: "Chip Design Engineer", shouldExclude: true },
  { title: "Semiconductor Engineer", shouldExclude: true },
  { title: "FPGA Engineer", shouldExclude: true },
  { title: "VLSI Engineer", shouldExclude: true },
  { title: "Pre-Silicon Validation Engineer", shouldExclude: true },
  { title: "Post-Silicon Validation Engineer", shouldExclude: true },
  // DFT Exclusions (Must be rejected)
  { title: "Senior DFT Design Engineer, Google Cloud", shouldExclude: true },
  { title: "Senior DFT Design Engineer", shouldExclude: true },
  { title: "DFT Engineer", shouldExclude: true },
  { title: "Design for Testability Engineer", shouldExclude: true },
  { title: "DFT Verification Engineer", shouldExclude: true },
  { title: "Design-for-Test Engineer", shouldExclude: true },
  // Software Infrastructure & Platform roles (Must be retained)
  { title: "Software Engineer, Test Infrastructure", shouldExclude: false },
  { title: "Software Engineer, Developer Testing", shouldExclude: false },
  { title: "Software Engineer, AI Infrastructure", shouldExclude: false },
  { title: "Software Engineer - Hardware Infrastructure", shouldExclude: false },
  { title: "Backend Engineer - Platform", shouldExclude: false },
  { title: "Backend Engineer, Test Platform", shouldExclude: false },
  { title: "AI Platform Engineer", shouldExclude: false },
  { title: "Cloud Infrastructure Engineer", shouldExclude: false },
  { title: "Systems Software Engineer, Core", shouldExclude: false }
];

let hwPassed = 0;
for (const tc of hardwareTestCases) {
  const excluded = isHardwareSiliconExclusion(tc.title);
  assert.strictEqual(excluded, tc.shouldExclude, `Hardware/DFT exclusion mismatch for "${tc.title}" (got ${excluded}, expected ${tc.shouldExclude})`);
  const status = excluded ? "REJECTED (Hardware/Silicon/DFT)" : "RETAINED (Software/Platform)";
  console.log(`✅ Passed: "${tc.title}" -> ${status}`);
  hwPassed++;
}

console.log(`\n🎉 All ${passedCount + hwPassed} / ${auditTestCases.length + hardwareTestCases.length} regression tests passed successfully!\n`);



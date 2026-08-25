# Developer Guide & Verification Battery — Career-Ops India

This document guides local setup, running verification tests, adding new ATS adapters, and managing daily workflows.

---

## 1. Quick Start

```bash
# 1. Install Node.js dependencies
npm install

# 2. Setup Python environment (for stealth scrapers)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Verify environment health
npm run doctor

# 4. Execute full scan across 65+ tracked companies
npm run scan

# 5. Open the visual Kanban Dashboard
npm run dashboard
```

---

## 2. Regression & Invariant Test Battery

To ensure zero regressions across taxonomy, adapters, state managers, and pipeline locks:

```bash
# Run all automated test suites via npm
npm test

# Or run individual test suites
node tests/test-taxonomy.mjs           # Taxonomy, exclusions & experience filters
node tests/test-ai-evaluator.mjs       # Evaluation logic, score bands & cache keys
node tests/test-discovery-ingest.mjs   # Discovery ingestion & ATS precedence
node tests/test-wave1-adapters.mjs     # Direct ATS protocol adapters
node tests/test-wave1-fixes.mjs        # Adapter site parameters & edge cases
node tests/test-eightfold-adapter.mjs  # Eightfold adapter & query pagination
node tests/test-application-state.mjs  # Application state & dashboard REST APIs
node tests/test-job-lifecycle.mjs      # Job lifecycle availability & auto-restore
node tests/test-daily-pipeline.mjs     # Pipeline orchestration, locking & recovery
node tests/test-state-fixes.mjs        # AI cache reattach, URL persistence, snapshot & orphans
```

---

## 3. Adding a New ATS Adapter

1. Create adapter in `scripts/adapters/<provider>.mjs`:
   ```javascript
   export default {
     id: "provider_name",
     type: "employer_ats",
     async fetchJobs(company) { /* ... */ },
     normalize(rawJob, company) { /* ... */ }
   };
   ```
2. Register adapter in [`scripts/adapters/index.mjs`](file:///Users/joshwadhwa/Projects/repos/career-ops-india/scripts/adapters/index.mjs).
3. Add company entry in [`portals/india.yml`](file:///Users/joshwadhwa/Projects/repos/career-ops-india/portals/india.yml).
4. Add unit test fixture in `tests/test-wave1-adapters.mjs`.


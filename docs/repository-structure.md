# Repository Structure Specification — Career-Ops India

This document details the directory organization, architectural responsibilities, dependency direction, and developer extension points for the **Career-Ops India** codebase.

---

## 1. Directory Tree

```
career-ops-india/
├── config/                         # Profile configurations & templates
│   ├── profile.example.yml         # Safe, anonymized configuration template
│   └── profile.yml                 # Private local user configuration (gitignored)
├── data/                           # Canonical datasets & state stores (zero database)
│   ├── .gitkeep                    # Directory preservation
│   ├── application_state.example.json # Safe example application state schema
│   ├── job_lifecycle_state.example.json # Safe example lifecycle state schema
│   ├── scan_results.json           # Canonical scanned jobs dataset (gitignored)
│   ├── application_state.json      # Private user application state (gitignored)
│   ├── job_lifecycle_state.json    # Private job availability state (gitignored)
│   └── .ai_cache.json              # Private SHA-256 LLM evaluation cache (gitignored)
├── docs/                           # Architectural specifications & guides
│   ├── architecture.md             # High-level architecture & component diagram
│   ├── data-flow.md                # End-to-end data sequence flow
│   ├── pipeline.md                 # Daily job hunt orchestration & locking
│   ├── adapters.md                 # Reference guide for 11 ATS adapters
│   ├── state-model.md              # Multi-dimensional state model specification
│   ├── development.md              # Developer testing & diagnostic battery
│   └── repository-structure.md     # Directory layout & contribution guide
├── modes/                          # AI CLI prompt mode definitions (Claude / Gemini)
│   ├── _shared.md
│   ├── evaluate.md
│   ├── scan.md
│   ├── pdf.md
│   └── ...
├── portals/                        # Employer ATS company definitions & expansion maps
│   ├── india.yml                   # Active 65+ tracked Tier 0/1/2 employer boards
│   ├── priority_targets.yml        # Tier 1/2 expansion roadmap
│   ├── candidates.yml              # Canonical company universe
│   └── migrations.yml              # ATS platform migration history
├── scrapers/                       # Python aggregator scrapers
│   ├── naukri_stealth.py           # Stealth Naukri search scraper
│   └── smart_job_scraper.py        # Generic ScrapeGraphAI scraper
├── scripts/                        # Production core modules & adapters
│   ├── scan.mjs                    # Main ATS scanner & deterministic taxonomy engine
│   ├── daily-pipeline.mjs          # Central daily job hunt orchestrator
│   ├── queue.mjs                   # CLI Queue viewer
│   ├── queue-core.mjs              # Queue ranking & 5/co diversification core
│   ├── state-service.mjs           # Application state manager (new, saved, applied, not_interested)
│   ├── job-lifecycle-service.mjs   # Availability lifecycle manager (active, stale, expired)
│   ├── dashboard-server.mjs        # Native HTTP server & REST APIs
│   ├── open-dashboard.mjs          # Dashboard launcher
│   ├── ingest-discovery.mjs        # Aggregator discovery merger
│   ├── discover.mjs                # Multi-source discovery runner
│   ├── evaluate.mjs                # Single-job evaluation CLI
│   ├── doctor.mjs                  # Environment diagnostics
│   ├── coverage.mjs                # Portal coverage reporter
│   ├── generate-pdf.mjs            # Tailored resume PDF builder
│   ├── adapters/                   # Direct ATS protocol adapters
│   │   ├── index.mjs               # Adapter registry & dynamic dispatcher
│   │   ├── workday.mjs             # Workday CXS JSON API adapter
│   │   ├── smartrecruiters.mjs     # SmartRecruiters Public API adapter
│   │   ├── greenhouse.mjs          # Greenhouse Public JSON API adapter
│   │   ├── lever.mjs               # Lever Postings API adapter
│   │   ├── ashby.mjs               # Ashby API adapter
│   │   ├── oraclecloud.mjs         # Oracle Cloud HCM REST API adapter
│   │   ├── google.mjs              # Google Careers SSR HTML adapter
│   │   ├── deshaw.mjs              # D.E. Shaw Next.js SSR adapter
│   │   ├── amazon.mjs              # Amazon Jobs REST API adapter
│   │   ├── pcsx.mjs                # Eightfold PCSX public search API adapter (MS, Qualcomm, Micron, MS, Vodafone)
│   │   ├── radancy.mjs             # Radancy / TalentBrew adapter (Barclays, Capital One, Optum, etc.)
│   │   ├── successfactors.mjs      # SAP SuccessFactors CSB adapter
│   │   ├── ibm.mjs                 # IBM Careers search API adapter
│   │   ├── rippling.mjs            # Rippling ATS REST API v2 adapter
│   │   └── mynexthire.mjs          # MyNextHire API adapter
│   ├── ai/                         # Gemini Flash LLM fit evaluator & caching
│   │   ├── evaluator.mjs           # Batch candidate evaluation engine
│   │   ├── prompt.mjs              # CV + JD prompt synthesizer
│   │   └── provider.mjs            # LLM API caller & JSON response parser
│   └── tools/                      # Reusable diagnostic & audit utilities
│       ├── backfill-application-snapshots.mjs # One-time idempotent application snapshot backfiller
│       ├── audit-company-coverage.mjs # Company coverage gap auditor
│       └── audit_hardware_exclusions.mjs # Hardware & DFT exclusion auditor
├── templates/                      # UI and document templates
│   ├── dashboard.html              # Reactive local Kanban dashboard UI
│   ├── cv-template.html            # Puppeteer resume HTML template
│   └── cv-template.md              # Markdown resume source
├── tests/                          # Automated regression & invariant test suites
│   ├── test-taxonomy.mjs           # 59 assertions: taxonomy, hardware/DFT exclusions, YOE
│   ├── test-ai-evaluator.mjs       # 29 assertions: scoring, confidence, caching
│   ├── test-discovery-ingest.mjs   # 10 assertions: aggregator normalization & ATS precedence
│   ├── test-wave1-adapters.mjs     # 6 assertions: Oracle Cloud HCM, Google SSR, D.E. Shaw
│   ├── test-wave1-fixes.mjs        # 3 assertions: Wave 1 edge cases & site parameters
│   ├── test-microsoft-adapter.mjs  # 7 assertions: Microsoft PCSX API adapter
│   ├── test-radancy-adapter.mjs    # 6 assertions: Radancy TalentBrew adapter
│   ├── test-successfactors-adapter.mjs # 3 assertions: SAP SuccessFactors CSB adapter
│   ├── test-ibm-adapter.mjs        # 3 assertions: IBM Careers search API adapter
│   ├── test-application-state.mjs  # 12 assertions: state persistence & REST API
│   ├── test-job-lifecycle.mjs      # 15 assertions: availability reconciliation & quota release
│   ├── test-daily-pipeline.mjs     # 10 assertions: locking, recovery, partial failure resilience
│   └── test-state-fixes.mjs        # 18 assertions: cache reattach, URL persistence, snapshot & orphans
├── .gitignore                      # Git exclusion rules
├── package.json                    # Dependencies & npm run scripts
└── README.md                       # Comprehensive user guide & architecture overview
```

---

## 2. Architectural Responsibilities by Directory

### `scripts/` — Production Core
Contains the runtime business logic of Career-Ops:
- `scan.mjs`: Queries all active employer portals, executes 4-gate taxonomy, computes deterministic scores, and saves `data/scan_results.json`.
- `daily-pipeline.mjs`: Orchestrates the daily pipeline (scan $\rightarrow$ evaluate 50 ATS / 10 discovery $\rightarrow$ queue $\rightarrow$ dashboard sync) with file-level concurrency locks.
- `state-service.mjs` & `job-lifecycle-service.mjs`: Provide orthogonal, multi-dimensional state tracking with atomic disk persistence.
- `queue-core.mjs`: Enforces queue ranking precedence (`APPLY` > `CONSIDER` > `UNEVAL` > `STRETCH`) and the 5-job/company diversification limit.
- `dashboard-server.mjs`: Exposes REST endpoints (`/api/jobs`, `/api/state`, `/api/lifecycle`, `/api/pipeline/run`, `/api/pipeline/status`) and serves the local dashboard.

### `scripts/adapters/` — Direct ATS Adapters
Contains pure, zero-browser protocol adapters extracting job postings via direct HTTP endpoints:
- Each adapter exports `id`, `type`, `fetchJobs(companyConfig)`, and `normalize(rawJob, companyConfig)`.
- All adapters normalize diverse schemas to the canonical `CanonicalJob` contract.

### `scripts/ai/` — AI Fit Evaluation Engine
Encapsulates all LLM interaction:
- `evaluator.mjs`: Manages candidate selection, batch execution, and deterministic SHA-256 prompt caching.
- `prompt.mjs`: Injects candidate CV ([`cv.md`](file:///Users/joshwadhwa/Projects/repos/career-ops-india/cv.md)), target salary bands, and JD context.
- `provider.mjs`: Calls Gemini Flash via Google Gemini SDK or CLI.

### `scripts/tools/` — Developer Utilities
Non-production diagnostic utilities used for coverage gap analysis, taxonomy calibration, and board audits:
- `audit-company-coverage.mjs`: Audits ATS coverage across 200+ target Indian tech firms (`npm run audit:coverage`).
- `audit_hardware_exclusions.mjs`: Validates hardware/silicon/DFT exclusion filtering against active scan results.

### `tests/` — Automated Regression Suites
Contains isolated, offline test suites verifying system invariants:
- Zero external network dependencies for baseline tests (all mock fixtures are embedded).
- Executed via `npm test` or individually with `node tests/<suite-name>.mjs`.

---

## 3. Developer Extension Points

Where to add code for future enhancements:

| Task | Target Directory / File | Protocol |
|---|---|---|
| **Add a new ATS adapter** | `scripts/adapters/<new-adapter>.mjs` | Implement `fetchJobs` & `normalize`, register in `scripts/adapters/index.mjs`, and add test in `tests/test-wave1-adapters.mjs`. |
| **Track a new company** | `portals/india.yml` | Add entry with `name`, `tier` ("0"/"1"/"2"), `priority` ("GO"/"GOOD"), and ATS config. |
| **Add a taxonomy filter** | `scripts/scan.mjs` (`HARD_EXCLUSIONS`) | Add regex pattern and add assertion in `tests/test-taxonomy.mjs`. |
| **Modify AI evaluation criteria** | `scripts/ai/prompt.mjs` | Adjust prompt rubric and update calibration tests in `tests/test-ai-evaluator.mjs`. |
| **Add a new test suite** | `tests/test-<feature>.mjs` | Create isolated unit test and append command to `"test"` script in `package.json`. |
| **Add a dashboard feature** | `templates/dashboard.html` & `scripts/dashboard-server.mjs` | Update HTML/JS UI and add REST endpoint in `dashboard-server.mjs`. |
| **Add an aggregator scraper** | `scrapers/<source>.py` | Output to `data/discovery_results.json` and merge via `scripts/ingest-discovery.mjs`. |


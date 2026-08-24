# System Architecture & Component Design — Career-Ops India

**Career-Ops India** is an autonomous, agentic, zero-database career pipeline designed for the Indian technology job market. It pairs with modern AI developer environments (Google Gemini CLI and Anthropic Claude Code) to provide direct ATS ingestion, deterministic taxonomy scoring, LLM fit evaluation, orthogonal state management, and a local reactive Kanban dashboard.

---

## 1. High-Level System Architecture

```mermaid
graph TD
    subgraph UI_Layer["1. User Interfaces & CLI"]
        CLI_Scan["npm run scan"]
        CLI_Queue["npm run queue"]
        CLI_Daily["npm run daily"]
        CLI_Eval["npm run evaluate"]
        Dashboard_UI["Local Kanban UI (templates/dashboard.html)"]
    end

    subgraph Server_Layer["2. Server & Orchestration Layer"]
        DashServer["scripts/dashboard-server.mjs<br/>(HTTP REST API: /api/jobs, /api/state, /api/lifecycle, /api/pipeline)"]
        DailyPipe["scripts/daily-pipeline.mjs<br/>(4-Stage Orchestrator & Concurrency Lock)"]
    end

    subgraph Domain_Layer["3. Core Domain & Pipeline Engines"]
        ScanEngine["scripts/scan.mjs<br/>(4-Gate Semantic Taxonomy & Deterministic Scorer)"]
        QueueCore["scripts/queue-core.mjs<br/>(Queue Ranking & 5/co Diversification Engine)"]
        StateService["scripts/state-service.mjs<br/>(Application State: new, saved, applied, not_interested)"]
        LifecycleService["scripts/job-lifecycle-service.mjs<br/>(Availability Lifecycle: active, stale, expired)"]
        DiscIngest["scripts/ingest-discovery.mjs<br/>(Aggregator Ingest & ATS Precedence)"]
    end

    subgraph Integration_Layer["4. Ingestion & AI Boundaries"]
        AdapterRegistry["scripts/adapters/index.mjs<br/>(11 Direct ATS Protocol Adapters)"]
        AIEvaluator["scripts/ai/evaluator.mjs<br/>(Gemini Flash Fit Evaluator & Prompt Synthesizer)"]
        AICache["scripts/ai/evaluator.mjs<br/>(Deterministic SHA-256 Prompt Caching)"]
        Scrapers["scrapers/naukri_stealth.py<br/>scrapers/smart_job_scraper.py"]
    end

    subgraph Storage_Layer["5. Zero-Database JSON Storage Layer"]
        ScanData[("data/scan_results.json<br/>(Canonical Scanned Jobs)")]
        AppState[("data/application_state.json<br/>(User Application Actions)")]
        LifeState[("data/job_lifecycle_state.json<br/>(Job Availability State)")]
        PromptCache[("data/.ai_cache.json<br/>(LLM Verdict Cache)")]
        DiscData[("data/discovery_results.json<br/>(Raw Discovery Postings)")]
        LockFile[("data/daily-pipeline.lock<br/>(Concurrency Lock)")]
    end

    CLI_Scan --> ScanEngine
    CLI_Queue --> QueueCore
    CLI_Daily --> DailyPipe
    CLI_Eval --> AIEvaluator
    Dashboard_UI <--> DashServer

    DashServer --> StateService
    DashServer --> LifecycleService
    DashServer --> QueueCore
    DashServer --> DailyPipe

    DailyPipe --> LockFile
    DailyPipe --> ScanEngine
    DailyPipe --> LifecycleService
    DailyPipe --> AIEvaluator
    DailyPipe --> QueueCore

    ScanEngine --> AdapterRegistry
    ScanEngine --> ScanData
    
    AIEvaluator --> AICache
    AICache <--> PromptCache
    AIEvaluator --> ScanData

    Scrapers --> DiscData
    DiscData --> DiscIngest
    DiscIngest --> ScanData

    StateService <--> AppState
    LifecycleService <--> LifeState
    LifecycleService --> StateService
    QueueCore --> ScanData
    QueueCore --> StateService
    QueueCore --> LifecycleService
```

---

## 2. Subsystem Breakdown & Component Responsibilities

| Subsystem | Primary Modules | Architectural Responsibility | Key Inputs / Outputs |
|---|---|---|---|
| **Orchestration** | `daily-pipeline.mjs`, `dashboard-server.mjs` | Controls high-level execution, enforces single-process concurrency locking, serves REST APIs, and coordinates multi-stage daily job hunts. | Input: CLI args / HTTP POST<br/>Output: Telemetry status, HTTP JSON responses |
| **Ingestion** | `scan.mjs`, `adapters/*`, `scrapers/*` | Queries 65+ employer ATS boards via direct HTTP APIs without browser automation; normalizes disparate payloads into `CanonicalJob` schema. | Input: `portals/india.yml`<br/>Output: `data/scan_results.json` |
| **Semantic Taxonomy** | `scan.mjs` | Multi-gate filtering (Hard Exclusions $\rightarrow$ Function Classification $\rightarrow$ Experience/Seniority Normalization $\rightarrow$ Deterministic 100-pt Scoring). | Input: Raw ATS job payloads<br/>Output: Filtered & scored job entities |
| **AI Evaluation** | `ai/evaluator.mjs`, `ai/prompt.mjs`, `ai/provider.mjs` | Selects high-priority unevaluated jobs, synthesizes candidate CV with JD requirements, queries Gemini Flash, and caches verdicts by SHA-256 prompt hash. | Input: `cv.md`, `scan_results.json`<br/>Output: `ai_evaluation` metadata, `data/.ai_cache.json` |
| **Application State** | `state-service.mjs` | Tracks user application actions (`new`, `saved`, `applied`, `not_interested`) with deterministic job IDs and atomic file writes. | Input: Job ID + action<br/>Output: `data/application_state.json` |
| **Job Lifecycle** | `job-lifecycle-service.mjs` | Tracks portal posting availability (`active`, `stale`, `expired`) with automated rescan reconciliation and quota-freeing manual expiration. | Input: Scanned jobs + user action<br/>Output: `data/job_lifecycle_state.json` |
| **Queue & Ranking** | `queue-core.mjs`, `queue.mjs` | Enforces ranking precedence (`APPLY` > `CONSIDER` > `UNEVAL` > `STRETCH`) and limits company recommendations to max 5/company. | Input: `scan_results`, `app_state`, `lifecycle`<br/>Output: Partitioned, diversified queues |
| **User Interface** | `templates/dashboard.html` | Pure HTML5/vanilla JS single-page dashboard with Kanban columns, live pipeline trigger, filtering, and manual action hooks. | Input: `GET /api/jobs`, `GET /api/state`<br/>Output: DOM rendered UI |

---

## 3. Data Ownership & Storage Boundaries

The platform strictly maintains zero shared mutable state. Data ownership is partitioned as follows:

```mermaid
classDiagram
    class ScanResults {
        <<data/scan_results.json>>
        +String scanned_at
        +Number total
        +CanonicalJob[] jobs
        +Owned By: scripts/scan.mjs
    }

    class ApplicationState {
        <<data/application_state.json>>
        +Map~String, StateRecord~ records
        +String status: new | saved | applied | not_interested
        +Owned By: scripts/state-service.mjs
    }

    class JobLifecycleState {
        <<data/job_lifecycle_state.json>>
        +Map~String, LifecycleRecord~ records
        +String status: active | stale | expired
        +Owned By: scripts/job-lifecycle-service.mjs
    }

    class AICache {
        <<data/.ai_cache.json>>
        +Map~String, EvaluationVerdict~ cache
        +Owned By: scripts/ai/evaluator.mjs
    }

    ScanResults "1" ..> "1" ApplicationState : joined via getJobId()
    ScanResults "1" ..> "1" JobLifecycleState : joined via getJobId()
    ScanResults "1" ..> "1" AICache : keyed by SHA-256 hash
```

1. **`data/scan_results.json`**:
   - **Exclusive Writer**: `scripts/scan.mjs`.
   - **Content**: Canonical scraped postings, deterministic taxonomy scores, and attached AI evaluation metadata.
   - **Guarantee**: Scanner never mutates user application state or lifecycle state.

2. **`data/application_state.json`**:
   - **Exclusive Writer**: `scripts/state-service.mjs`.
   - **Content**: User interaction history (`applied`, `saved`, `not_interested`).
   - **Guarantee**: Never modified by scan runs, AI evaluations, or pipeline rebuilds.

3. **`data/job_lifecycle_state.json`**:
   - **Exclusive Writer**: `scripts/job-lifecycle-service.mjs`.
   - **Content**: Availability records (`expired`, `stale`, `active`).
   - **Guarantee**: Decoupled from user actions. Expiring a job does NOT mark it applied; applying does NOT alter lifecycle.

4. **`data/.ai_cache.json`**:
   - **Exclusive Writer**: `scripts/ai/evaluator.mjs`.
   - **Content**: SHA-256 hash-keyed evaluation results.
   - **Guarantee**: 100% token reuse for identical JD and profile inputs across runs.

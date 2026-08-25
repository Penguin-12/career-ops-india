# Data Flow & Execution Specifications — Career-Ops India

This document details the exact execution paths, data mutations, and component interactions across the five primary workflows in **Career-Ops India**.

---

## 1. Daily Pipeline Workflow (One-Click Job Hunt)

```mermaid
sequenceDiagram
    autonumber
    actor User as User (UI / CLI)
    participant Pipe as daily-pipeline.mjs
    participant Lock as Lockfile (data/daily-pipeline.lock)
    participant Scan as scan.mjs
    participant Recon as job-lifecycle-service.mjs
    participant Eval as ai/evaluator.mjs
    participant Cache as data/.ai_cache.json
    participant Queue as queue-core.mjs
    participant Dash as dashboard-server.mjs

    User->>Pipe: Trigger npm run daily / POST /api/pipeline/run
    Pipe->>Lock: Acquire exclusive file lock
    alt Lock already held (< 15m)
        Lock-->>Pipe: Throw / Return HTTP 409 Conflict
        Pipe-->>User: Pipeline already running
    else Lock acquired / Stale auto-cleared
        Lock-->>Pipe: Lock established
    end

    Note over Pipe,Scan: Stage 1: Ingestion & Scan
    Pipe->>Scan: runScan({ silent: true })
    Scan->>Scan: Query 65+ ATS APIs, filter exclusions, calculate 100-pt scores
    Scan-->>Pipe: Returns { jobs, total, errors }

    Note over Pipe,Recon: Stage 1b: Lifecycle Availability Reconciliation
    Pipe->>Recon: reconcileJobLifecycle(jobs)
    Recon->>Recon: Auto-restore reappeared jobs -> "active"<br/>Mark absent tracked jobs -> "stale"

    Note over Pipe,Eval: Stage 2 & 3: Candidate Selection & Evaluation
    Pipe->>Eval: selectJobsForEvaluation(jobs, 50, 10)
    Note right of Eval: Selects Tier 0 > Tier 1 > Tier 2 > Stretch > Aggregators
    Pipe->>Eval: evaluateBatch(selectedCandidates, { concurrency: 4 })
    loop For each candidate
        Eval->>Cache: Query SHA-256 hash(prompt, jd)
        alt Cache Hit
            Cache-->>Eval: Return cached score & verdict (0 tokens)
        else Cache Miss
            Eval->>Eval: Call Gemini Flash API
            Eval-->>Cache: Persist new verdict to disk
        end
    end
    Eval-->>Pipe: Return evaluated jobs with attached ai_evaluation

    Note over Pipe,Queue: Stage 4: Queue Reconstruction & Diversification
    Pipe->>Queue: Filter un-actioned & active jobs -> Apply 5/co cap -> Partition queues
    Pipe->>Lock: Release lock & write .daily-pipeline-status.json
    Pipe-->>User: Emit complete telemetry & notify UI
```

---

## 2. Ingestion, Taxonomy & Normalization Flow

```mermaid
flowchart TD
    A[Start: runScan] --> B[Load config/profile.yml & portals/india.yml]
    B --> C[Fetch concurrently across 65+ companies via 11 ATS Adapters]
    
    C --> D[Raw Posting Entity]
    D --> Gate1{Gate 1: Hard Exclusions}
    Gate1 -- Matches Mgmt / Non-Tech / QA / Hardware-Silicon / DFT --> Drop1[❌ Drop Posting]
    Gate1 -- Clean Title --> Gate2{Gate 2: Technical Function}
    
    Gate2 -- No Backend/Platform/Distributed/AI signal --> Drop2[❌ Drop Posting]
    Gate2 -- Matches Target Family --> Gate3{Gate 3: Location & Freshness}
    
    Gate3 -- Outside India / Expired >30d --> Drop3[❌ Drop Posting]
    Gate3 -- Valid Location & Fresh --> Gate4{Gate 4: Experience Filter}
    
    Gate4 -- Requires >7 YOE --> Drop4[❌ Drop Posting]
    Gate4 -- 2-4 YOE --> PassPrimary[✓ Primary Match]
    Gate4 -- 5-7 YOE / Staff --> PassStretch[✓ Stretch Match]
    
    PassPrimary & PassStretch --> CalcScore[Compute 100-pt Deterministic Score]
    CalcScore --> Dedup[Deduplicate by URL / Company + Title]
    Dedup --> SaveScan[Atomic Save: data/scan_results.json]
```

---

## 3. Queue Construction & Dashboard Data Flow

```mermaid
flowchart TD
    ScanData[data/scan_results.json<br/>Current Scanned Jobs] --> Enrich[Enrich Scan Jobs with State & Lifecycle]
    
    Enrich --> PartState{Partition by Application State}
    PartState -- status: 'applied' (scan-matched) --> AppliedMerge
    PartState -- status: 'saved' --> TabSaved[💾 Saved View]
    PartState -- status: 'not_interested' --> TabExcluded[✕ Excluded View]
    PartState -- status: 'new' --> PartLife{Partition by Lifecycle State}
    
    PartLife -- lifecycle: 'expired' (scan-matched) --> ExpiredMerge
    PartLife -- lifecycle: 'stale' --> TabStale[⚠ Stale Tag / Held Outside Active Queue]
    PartLife -- lifecycle: 'active' --> Pool[Active Recommendation Candidate Pool]
    
    AppState[data/application_state.json<br/>Persisted User State & Snapshots] --> OrphanApplied[Build Orphan Applied Records<br/>Absent from latest scan]
    OrphanApplied --> AppliedMerge[Merge Scan-Matched + Orphan Applied]
    AppliedMerge --> TabApplied[✓ Applied View & Authoritative Count]
    
    LifeState[data/job_lifecycle_state.json<br/>Persisted Lifecycle State] --> OrphanExpired[Build Orphan Expired Records<br/>Absent from latest scan]
    OrphanExpired --> ExpiredMerge[Merge Scan-Matched + Orphan Expired]
    ExpiredMerge --> TabExpired[✕ Expired View & Authoritative Count]

    Pool --> PartAI[Partition by AI Recommendation]
    PartAI -- AI: 'APPLY' (Score >= 80) --> SortApply[Sort by AI Score Descending]
    PartAI -- AI: 'CONSIDER' (Score 60-79) --> SortConsider[Sort by AI Score Descending]
    PartAI -- Unevaluated --> SortNew[Sort by Deterministic Score Descending]
    
    SortApply --> DivApply{Apply 5/Company Diversification Cap}
    DivApply -- Within 5/company quota --> QueueApply[🔥 1. APPLY NOW Queue]
    DivApply -- Exceeds 5/company quota --> QueueApplyOverflow[Backup Apply Opportunities]
    
    SortConsider --> QueueConsider[🟡 2. CONSIDER Queue]
    SortNew --> QueueNew[📋 3. NEW / UNEVALUATED Queue]
```

---

## 4. Job Lifecycle Availability State Machine

```mermaid
stateDiagram-v2
    [*] --> Active: Discovered in portal scan (default)
    
    Active --> Stale: Absent from subsequent scan (Reconciliation)
    Stale --> Active: Reappears in scan (Auto-restored by Scanner)
    
    Active --> Expired: User clicks [ ✕ Expired ] / Direct 403/404 detected
    Stale --> Expired: User clicks [ ✕ Expired ]
    
    Expired --> Active: User clicks [ ↩ Restore Active ]
    Expired --> Active: Reappears in live scan (Auto-restored by Scanner)
    
    note right of Expired
        Expired status immediately removes
        job from active recommendation queue
        and frees the company's 5-job cap.
    end note
```

---

## 5. Dashboard REST API Interaction Flow

```mermaid
sequenceDiagram
    autonumber
    actor Browser as Dashboard Client (templates/dashboard.html)
    participant Server as dashboard-server.mjs
    participant AppState as state-service.mjs
    participant LifeState as job-lifecycle-service.mjs
    participant ScanData as data/scan_results.json

    Browser->>Server: GET /api/jobs
    Server->>ScanData: Load raw scan results
    Server->>AppState: Load application state (including snapshots)
    Server->>LifeState: Load lifecycle state
    Server->>Server: Partition active queue & construct orphan applied/expired records
    Server-->>Browser: Return JSON (counts, partitioned queues, historical tabs)

    Browser->>Server: POST /api/state { jobId, status: 'applied', notes, job: { title, company, location, url } }
    Server->>AppState: setJobStatus(jobId, 'applied', { notes, job })
    Note over AppState: Captures immutable display snapshot { title, company, location, url }
    AppState->>AppState: Atomic write data/application_state.json
    Server-->>Browser: HTTP 200 OK { success: true }

    Browser->>Server: POST /api/lifecycle { jobId, status: 'expired' }
    Server->>LifeState: setJobLifecycleStatus(jobId, 'expired')
    LifeState->>LifeState: Atomic write data/job_lifecycle_state.json
    Server-->>Browser: HTTP 200 OK { success: true }

    Browser->>Server: POST /api/pipeline/run
    Server->>Server: Trigger daily pipeline asynchronously
    Server-->>Browser: HTTP 202 Accepted { message: "Daily pipeline started" }

    loop Poll every 2s
        Browser->>Server: GET /api/pipeline/status
        Server-->>Browser: Return JSON { isRunning, status, step, metrics }
    end
```

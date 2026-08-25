# Multi-Dimensional State Model — Career-Ops India

Career-Ops India enforces a fundamental architectural separation between **Application State**, **Job Availability Lifecycle**, and the **Canonical Scanned Dataset**.

---

## 1. Dimensional Separation

```mermaid
classDiagram
    class CanonicalJob {
        +String job_id
        +String company
        +String title
        +String location
        +String url
        +Number score
        +Object ai_evaluation
    }

    class ApplicationState {
        +String status: "new" | "saved" | "applied" | "not_interested"
        +String updated_at
        +String notes
        +Object job [optional]: { title, company, location, url }
    }

    class JobLifecycleState {
        +String status: "active" | "stale" | "expired"
        +String updated_at
        +String source: "manual" | "scanner" | "system"
        +String notes
    }

    CanonicalJob "1" -- "1" ApplicationState : user action
    CanonicalJob "1" -- "1" JobLifecycleState : portal availability
```

---

## 2. State Dimensions

### Dimension 1: Canonical Job Dataset (`data/scan_results.json`)
- **Authoritative source of currently active scanned job postings**.
- Generated exclusively by `scripts/scan.mjs`.
- Reattaches cached AI evaluations via canonical SHA-256 keys on every scan without consuming tokens.
- Completely decoupled from personal user actions.

### Dimension 2: Application State (`data/application_state.json`)
- Stores **user actions** against jobs:
  - `new`: Default un-actioned state.
  - `saved`: Bookmarked by user for later review.
  - `applied`: Application submitted (or interview/oa/offer/rejected).
  - `not_interested`: Explicitly passed by user.
- **Optional Immutable Display Snapshot (`entry.job`)**:
  - When a job transitions into a meaningful user state, an optional lightweight display snapshot is captured from the active job entity:
    ```json
    "job": {
      "title": "Senior Software Engineer",
      "company": "Acme Corp",
      "location": "Bengaluru, India",
      "url": "https://example.com/jobs/123"
    }
    ```
  - **Identity/Display Only**: Contains only non-volatile identity metadata (`title`, `company`, `location`, `url`). Volatile operational fields (e.g., `score`, `ai_evaluation`, `freshness_tier`, `age_days`, `snippet`) are strictly excluded to keep state storage lightweight.
  - **Historical Reconstruction**: Used by the dashboard to reconstruct rich archived cards if a posting later closes or disappears from `scan_results.json`.
  - **Snapshot Preservation**: Partial updates (e.g., updating notes or status via string ID) merge with and preserve existing snapshots.
  - **Backward Compatibility**: `entry.job` is **optional**. Existing legacy records without `job` remain fully valid and gracefully fall back to URL domain/slug inference.
- **Authoritative for Applied**: All persisted `applied` records remain visible in the dashboard **✓ Applied** view regardless of current scan presence.

### Dimension 3: Job Availability Lifecycle (`data/job_lifecycle_state.json`)
- Stores **portal availability & validity**:
  - `active`: Verified open and available.
  - `stale`: Absent from latest scan (retained in history, excluded from top recommendations).
  - `expired`: Manually or structurally marked closed/expired.
- **Authoritative for Expired**: Persisted expired records remain visible in the **✕ Expired** view.
- **Auto-Restoration**: If a previously expired or stale job reappears in a live portal scan, its lifecycle is automatically restored to `active` (`source: "scanner"`).

---

## 3. Historical Orphan Reconstruction

When an applied or expired job disappears from `scan_results.json`, `dashboard-server.mjs` reconstructs an archived representation:
1. **Tier 1 (Persisted Snapshot)**: If `entry.job` exists, uses the real `title`, `company`, `location`, and original clickable `url`.
2. **Tier 2 (Legacy Inference)**: For older records without snapshots, derives company from URL domain/slug via `extractCompanyHint()`, sets title to `"(Position no longer listed)"`, and location to `"—"`.
3. **Queue Isolation**: Orphan/archived records (`is_orphan: true`) display the `📦 Archived` badge in the UI and are strictly excluded from the active daily recommendation queue.

---

## 4. Historical Backfill Migration Tool

Legacy records in `application_state.json` created prior to snapshot support can be safely backfilled using:

```bash
node scripts/tools/backfill-application-snapshots.mjs
```

- **Scope**: One-time / manual utility (not part of the daily pipeline).
- **Matching**: Matches records against `data/scan_results.json` using exact URLs.
- **Safety**: Never scrapes external URLs, never fabricates metadata, and leaves unrecoverable records untouched.
- **Idempotency**: Running multiple times produces identical output and 0 re-writes.

---

## 5. State Orthogonality Examples

| Scenario | Application State | Lifecycle State | Resulting Behavior |
|---|---|---|---|
| New posting discovered | `new` | `active` | Surfaced in active recommendation queue |
| User applies to job | `applied` | `active` | Isolated in **✓ Applied** tab; excluded from daily recommendations |
| User saves job for weekend review | `saved` | `active` | Isolated in **💾 Saved** tab |
| Employer closes requisition on Workday | `new` | `expired` | Isolated in **✕ Expired** tab; frees up 5/co diversification quota |
| User applied, then employer closes role | `applied` | `expired` | Tracked under **✓ Applied** AND **✕ Expired** without conflict |
| Applied job aged out of scan | `applied` | `active` / `expired` | Retained as archived card in **✓ Applied** tab with real title/company snapshot |
| Job missing from 1 scan | `new` | `stale` | Tagged with `⚠ STALE`; held outside recommendations |


/**
 * scripts/job-lifecycle-service.mjs — Job Lifecycle State Manager
 * 
 * Manages job availability lifecycles (active, stale, expired) separately from
 * user application state (new, saved, applied, not_interested).
 * 
 * Key Invariant:
 * APPLICATION STATE ≠ JOB LIFECYCLE
 * A job can independently be applied + expired, saved + expired, new + stale, etc.
 * 
 * Storage: data/job_lifecycle_state.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getJobId } from "./state-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
export const DEFAULT_LIFECYCLE_FILE = path.join(ROOT, "data/job_lifecycle_state.json");

export const VALID_LIFECYCLE_STATUSES = new Set([
  "active",
  "stale",
  "expired"
]);

export const VALID_LIFECYCLE_SOURCES = new Set([
  "manual",
  "scanner",
  "system"
]);

/**
 * Loads job lifecycle state from disk with error resilience.
 */
export function loadJobLifecycleState(filePath = DEFAULT_LIFECYCLE_FILE) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return (data && typeof data === "object" && !Array.isArray(data)) ? data : {};
  } catch (err) {
    console.error(`⚠️  Warning: Failed to parse job lifecycle state from ${filePath}: ${err.message}`);
    return {};
  }
}

/**
 * Atomically saves job lifecycle state to disk using a temporary file and rename.
 */
export function saveJobLifecycleState(state, filePath = DEFAULT_LIFECYCLE_FILE) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Invalid job lifecycle state object");
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempFile = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const jsonContent = JSON.stringify(state, null, 2);

  fs.writeFileSync(tempFile, jsonContent, "utf8");
  fs.renameSync(tempFile, filePath);
  return true;
}

/**
 * Validates a lifecycle status string against supported values.
 */
export function validateLifecycleStatus(status) {
  const norm = String(status || "").toLowerCase().trim();
  return VALID_LIFECYCLE_STATUSES.has(norm);
}

/**
 * Resolves the lifecycle entry key for a job or ID with URL-first compatibility fallback.
 */
export function findLifecycleKey(jobOrId, state = {}) {
  if (!state || typeof state !== "object") return null;
  const id = typeof jobOrId === "string" ? jobOrId : getJobId(jobOrId);
  if (state[id]) return id;

  let url = null;
  if (typeof jobOrId === "object" && jobOrId !== null) {
    url = (jobOrId.url || jobOrId.apply_url || jobOrId.source_url || "").trim();
  } else if (typeof jobOrId === "string" && jobOrId.includes("http")) {
    url = jobOrId.slice(jobOrId.indexOf("http")).trim();
  }

  if (url && url.startsWith("http")) {
    for (const k of Object.keys(state)) {
      if (k.endsWith(`:${url}`) || k === url) {
        return k;
      }
    }
  }
  return null;
}

/**
 * Retrieves the lifecycle status for a job or ID. Defaults to status: 'active'.
 */
export function getJobLifecycleStatus(jobOrId, state = {}) {
  const key = findLifecycleKey(jobOrId, state);
  const entry = key ? state[key] : null;
  if (entry && entry.status && VALID_LIFECYCLE_STATUSES.has(entry.status)) {
    return {
      status: entry.status,
      updated_at: entry.updated_at || null,
      source: entry.source || "system",
      notes: entry.notes || ""
    };
  }
  return {
    status: "active",
    updated_at: null,
    source: "system",
    notes: ""
  };
}

/**
 * Sets lifecycle status for a job, updates timestamp, and persists atomically.
 */
export function setJobLifecycleStatus(jobOrId, status, options = {}) {
  const normStatus = String(status || "").toLowerCase().trim();
  if (!VALID_LIFECYCLE_STATUSES.has(normStatus)) {
    throw new Error(`Invalid lifecycle status '${status}'. Must be one of: ${Array.from(VALID_LIFECYCLE_STATUSES).join(", ")}`);
  }

  const filePath = options.filePath || DEFAULT_LIFECYCLE_FILE;
  const state = options.state || loadJobLifecycleState(filePath);
  const existingKey = findLifecycleKey(jobOrId, state);
  const id = existingKey || (typeof jobOrId === "string" ? jobOrId : getJobId(jobOrId));

  const existing = state[id] || {};
  const notes = options.notes !== undefined ? String(options.notes) : (existing.notes || "");
  const source = options.source && VALID_LIFECYCLE_SOURCES.has(options.source) ? options.source : (existing.source || "manual");

  state[id] = {
    status: normStatus,
    updated_at: options.updated_at || new Date().toISOString(),
    source,
    ...(notes ? { notes } : {})
  };

  if (options.autoSave !== false) {
    saveJobLifecycleState(state, filePath);
  }

  return {
    jobId: id,
    entry: state[id],
    state
  };
}

/**
 * Marks a job as expired (manually or system).
 */
export function markJobExpired(jobOrId, options = {}) {
  return setJobLifecycleStatus(jobOrId, "expired", { source: "manual", ...options });
}

/**
 * Restores a job to active lifecycle status.
 */
export function restoreJobActive(jobOrId, options = {}) {
  return setJobLifecycleStatus(jobOrId, "active", { source: "manual", ...options });
}

/**
 * Enriches a list of jobs with their computed lifecycle status.
 */
export function enrichJobsWithLifecycle(jobs, state = null, filePath = DEFAULT_LIFECYCLE_FILE) {
  const currentLifecycle = state || loadJobLifecycleState(filePath);
  return (jobs || []).map(job => {
    const id = job.job_id || getJobId(job);
    const lifecycle = getJobLifecycleStatus(job, currentLifecycle);
    return {
      ...job,
      job_id: id,
      lifecycle
    };
  });
}

/**
 * Partitions jobs based on lifecycle status (active, stale, expired).
 */
export function filterJobsByLifecycle(jobs, state = null, filePath = DEFAULT_LIFECYCLE_FILE) {
  const currentLifecycle = state || loadJobLifecycleState(filePath);
  const enriched = enrichJobsWithLifecycle(jobs, currentLifecycle, filePath);

  const active = [];
  const stale = [];
  const expired = [];

  for (const job of enriched) {
    const st = job.lifecycle?.status || "active";
    if (st === "expired") {
      expired.push(job);
    } else if (st === "stale") {
      stale.push(job);
    } else {
      active.push(job);
    }
  }

  return { active, stale, expired, all: enriched };
}

/**
 * Reconciles job lifecycle state against the latest scan dataset.
 * 
 * Rules:
 * 1. Job present in latest scan:
 *    - If previously marked expired or stale, automatically restore it to active (source: "scanner").
 *    - Does NOT mutate application state (applied, saved, not_interested remain untouched).
 * 2. Job in previous lifecycle state but absent from latest scan:
 *    - If previously active, mark 'stale' (source: "scanner").
 *    - If previously expired, preserve as 'expired'.
 * 3. Atomic persistence to data/job_lifecycle_state.json.
 */
export function reconcileJobLifecycle(scannedJobs, state = null, options = {}) {
  const filePath = options.filePath || DEFAULT_LIFECYCLE_FILE;
  const currentLifecycle = state || loadJobLifecycleState(filePath);
  const scannedJobIds = new Set((scannedJobs || []).map(j => getJobId(j)));
  const scannedUrls = new Set((scannedJobs || []).map(j => j.url || j.apply_url).filter(Boolean));
  const now = new Date().toISOString();

  // 1. Process jobs currently present in the scan
  for (const job of scannedJobs || []) {
    const existingKey = findLifecycleKey(job, currentLifecycle);
    if (existingKey && currentLifecycle[existingKey]) {
      const existing = currentLifecycle[existingKey];
      if (existing.status === "expired" || existing.status === "stale") {
        // Automatically restore reappeared job to active
        currentLifecycle[existingKey] = {
          status: "active",
          updated_at: now,
          source: "scanner",
          notes: "Automatically restored: reappeared in portal scan"
        };
      }
    }
  }

  // 2. Process previously tracked jobs now absent from the scan
  for (const [id, entry] of Object.entries(currentLifecycle)) {
    const colonIdx = id.indexOf(":");
    const url = colonIdx !== -1 ? id.substring(colonIdx + 1) : null;
    const isPresent = scannedJobIds.has(id) || (url && scannedUrls.has(url));

    if (!isPresent) {
      if (entry.status === "active") {
        currentLifecycle[id] = {
          ...entry,
          status: "stale",
          updated_at: now,
          source: "scanner",
          notes: "Marked stale: absent from latest portal scan"
        };
      }
      // Note: If already 'expired', leave as 'expired'
    }
  }

  if (options.autoSave !== false) {
    saveJobLifecycleState(currentLifecycle, filePath);
  }

  return currentLifecycle;
}


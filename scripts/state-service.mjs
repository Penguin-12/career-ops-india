/**
 * scripts/state-service.mjs — Persistent Application State Manager
 * 
 * Manages user application state (new, saved, applied, not_interested)
 * against scanned jobs with atomic JSON persistence in data/application_state.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
export const DEFAULT_STATE_FILE = path.join(ROOT, "data/application_state.json");

export const VALID_STATUSES = new Set([
  "new",
  "saved",
  "applied",
  "not_interested",
  "oa",
  "interview",
  "rejected",
  "withdrawn"
]);

function normaliseText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Derives a stable, deterministic job identifier from canonical metadata.
 * Hierarchy:
 * 1. source + ":" + source_job_id (if present)
 * 2. source + ":" + url (if url present)
 * 3. source + ":" + normalise(company) + ":" + normalise(title) + ":" + normalise(location)
 */
export function getJobId(job) {
  if (!job || typeof job !== "object") return "unknown";
  
  if (job.id && typeof job.id === "string") return job.id;
  if (job.job_id && typeof job.job_id === "string") return job.job_id;

  const source = normaliseText(job.source || "job") || "job";

  if (job.source_job_id) {
    return `${source}:${String(job.source_job_id).trim()}`;
  }

  if (job.url && typeof job.url === "string" && job.url.startsWith("http")) {
    return `${source}:${job.url.trim()}`;
  }

  const comp = normaliseText(job.company || "unknown");
  const title = normaliseText(job.title || "unknown");
  const loc = normaliseText(job.location || "india");

  return `${source}:${comp}:${title}:${loc}`;
}

/**
 * Loads application state from JSON file with error resilience.
 */
export function loadApplicationState(filePath = DEFAULT_STATE_FILE) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return (data && typeof data === "object" && !Array.isArray(data)) ? data : {};
  } catch (err) {
    console.error(`⚠️  Warning: Failed to parse application state from ${filePath}: ${err.message}`);
    return {};
  }
}

/**
 * Atomically saves application state to disk using a temporary file and rename.
 */
export function saveApplicationState(state, filePath = DEFAULT_STATE_FILE) {
  if (!state || typeof state !== "object") {
    throw new Error("Invalid application state object");
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
 * Validates a status string against supported values.
 */
export function validateStatus(status) {
  const norm = String(status || "").toLowerCase().trim();
  return VALID_STATUSES.has(norm);
}

/**
 * Extracts a minimal immutable identity/display snapshot from a job record.
 * Contains only { title, company, location, url } — zero volatile scan/score/evaluation data.
 */
export function extractJobSnapshot(job) {
  if (!job || typeof job !== "object") return null;
  const title = job.title ? String(job.title).trim() : undefined;
  const company = job.company ? String(job.company).trim() : undefined;
  const location = job.location ? String(job.location).trim() : undefined;
  const url = job.apply_url || job.url || job.source_url || undefined;
  const trimmedUrl = url ? String(url).trim() : undefined;

  if (!title && !company && !location && !trimmedUrl) return null;

  const snapshot = {};
  if (title) snapshot.title = title;
  if (company) snapshot.company = company;
  if (location) snapshot.location = location;
  if (trimmedUrl) snapshot.url = trimmedUrl;

  return snapshot;
}

/**
 * Retrieves the application state for a job or ID. Defaults to status: 'new'.
 */
export function getJobStatus(jobOrId, state = {}) {
  const id = typeof jobOrId === "string" ? jobOrId : getJobId(jobOrId);
  const entry = state[id];
  if (entry && entry.status && VALID_STATUSES.has(entry.status)) {
    return {
      status: entry.status,
      updated_at: entry.updated_at || null,
      notes: entry.notes || "",
      ...(entry.job ? { job: entry.job } : {})
    };
  }
  return {
    status: "new",
    updated_at: null,
    notes: ""
  };
}

/**
 * Sets status for a job, updates timestamp, and optionally persists atomically.
 * Captures an immutable { title, company, location, url } snapshot from the job record
 * at the moment of state transition, allowing historical orphan records to be reconstructed
 * even after disappearing from future scan results.
 */
export function setJobStatus(jobOrId, status, options = {}) {
  const normStatus = String(status || "").toLowerCase().trim();
  if (!VALID_STATUSES.has(normStatus)) {
    throw new Error(`Invalid status '${status}'. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}`);
  }

  const filePath = options.filePath || DEFAULT_STATE_FILE;
  const state = options.state || loadApplicationState(filePath);
  const id = typeof jobOrId === "string" ? jobOrId : getJobId(jobOrId);

  const existing = state[id] || {};
  const notes = options.notes !== undefined ? String(options.notes) : (existing.notes || "");

  if (normStatus === "new") {
    // Resetting to new removes explicit action from state or sets status new
    delete state[id];
  } else {
    // Extract snapshot from job object if provided, otherwise preserve existing snapshot
    const sourceJob = typeof jobOrId === "object" && jobOrId !== null
      ? jobOrId
      : (options.job || options.snapshot || null);
    const newSnapshot = extractJobSnapshot(sourceJob);
    const existingSnapshot = existing.job || null;

    // Merge: new snapshot fields take precedence over existing, but existing fields are preserved if new is incomplete
    const mergedSnapshot = (newSnapshot || existingSnapshot) ? {
      ...(existingSnapshot || {}),
      ...(newSnapshot || {})
    } : null;

    state[id] = {
      status: normStatus,
      updated_at: options.updated_at || new Date().toISOString(),
      ...(notes ? { notes } : {}),
      ...(mergedSnapshot && Object.keys(mergedSnapshot).length > 0 ? { job: mergedSnapshot } : {})
    };
  }

  if (options.autoSave !== false) {
    saveApplicationState(state, filePath);
  }

  return {
    jobId: id,
    entry: state[id] || { status: "new", updated_at: null, notes: "" },
    state
  };
}

/**
 * Clears or resets status for a job back to 'new'.
 */
export function clearJobStatus(jobOrId, options = {}) {
  return setJobStatus(jobOrId, "new", options);
}

/**
 * Enriches a list of jobs with their computed stable ID and current state.
 */
export function enrichJobsWithState(jobs, state = null, filePath = DEFAULT_STATE_FILE) {
  const currentState = state || loadApplicationState(filePath);
  return (jobs || []).map(job => {
    const id = getJobId(job);
    const appState = getJobStatus(id, currentState);
    return {
      ...job,
      job_id: id,
      application_state: appState
    };
  });
}

/**
 * Filters and partitions a list of jobs based on application state.
 * - active: un-actioned / new jobs (eligible for daily recommendations)
 * - saved: jobs marked 'saved'
 * - applied: jobs marked 'applied' (or interview/oa/etc.)
 * - not_interested: jobs marked 'not_interested'
 */
export function filterJobsByState(jobs, state = null, filePath = DEFAULT_STATE_FILE) {
  const currentState = state || loadApplicationState(filePath);
  const enriched = enrichJobsWithState(jobs, currentState, filePath);

  const active = [];
  const saved = [];
  const applied = [];
  const notInterested = [];

  for (const job of enriched) {
    const st = job.application_state?.status || "new";
    if (st === "saved") {
      saved.push(job);
    } else if (st === "applied" || st === "oa" || st === "interview" || st === "rejected" || st === "withdrawn") {
      applied.push(job);
    } else if (st === "not_interested") {
      notInterested.push(job);
    } else {
      active.push(job);
    }
  }

  return { active, saved, applied, notInterested, all: enriched };
}


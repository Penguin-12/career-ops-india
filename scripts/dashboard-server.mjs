#!/usr/bin/env node
/**
 * scripts/dashboard-server.mjs — Local HTTP Server & API for Career-Ops Dashboard
 * 
 * Built with Node.js native HTTP module. Zero external framework dependencies.
 * Provides REST endpoints for job inspection, application state persistence,
 * and serves the reactive dashboard web interface.
 * 
 * Run:  node scripts/dashboard-server.mjs
 * Run:  npm run dashboard
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import {
  loadApplicationState,
  saveApplicationState,
  getJobStatus,
  setJobStatus,
  clearJobStatus,
  enrichJobsWithState,
  filterJobsByState,
  getJobId,
  VALID_STATUSES
} from "./state-service.mjs";
import {
  loadJobLifecycleState,
  saveJobLifecycleState,
  getJobLifecycleStatus,
  setJobLifecycleStatus,
  enrichJobsWithLifecycle,
  filterJobsByLifecycle,
  VALID_LIFECYCLE_STATUSES
} from "./job-lifecycle-service.mjs";
import { partitionQueue, diversifyJobs } from "./queue-core.mjs";
import { runDailyPipeline, getPipelineStatus, isPipelineRunning } from "./daily-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCAN_RESULTS_PATH = path.join(ROOT, "data/scan_results.json");
const TEMPLATE_PATH = path.join(ROOT, "templates/dashboard.html");
const DEFAULT_PORT = parseInt(process.env.PORT || "3000", 10);

/**
 * Loads canonical scan results from disk safely.
 */
function loadScanResults() {
  if (!fs.existsSync(SCAN_RESULTS_PATH)) {
    return { scanned_at: null, total: 0, jobs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(SCAN_RESULTS_PATH, "utf8"));
  } catch (err) {
    console.error(`⚠️ Failed to parse scan_results.json: ${err.message}`);
    return { scanned_at: null, total: 0, jobs: [] };
  }
}

/**
 * Builds the aggregated payload combining canonical jobs, state, lifecycle, and partitioned queues.
 */
export function buildDashboardData() {
  const scanData = loadScanResults();
  const rawJobs = scanData.jobs || [];
  const appState = loadApplicationState();
  const lifecycleState = loadJobLifecycleState();

  // Enrich all jobs with both application state and lifecycle status
  const enrichedWithState = enrichJobsWithState(rawJobs, appState);
  const allEnriched = enrichJobsWithLifecycle(enrichedWithState, lifecycleState);

  // Partition jobs by user application state
  const { active: unActioned, saved, applied, notInterested } = filterJobsByState(allEnriched, appState);

  // Partition un-actioned jobs by lifecycle state
  const { active: activeEligible, stale: activeStale, expired: activeExpired } = filterJobsByLifecycle(unActioned, lifecycleState);

  // Partition active (new/un-actioned + active lifecycle) jobs through canonical queue ranking & diversification
  const activeQueue = partitionQueue(activeEligible, 5);

  // Collect all expired and stale jobs across entire dataset for dedicated tabs/views
  const allExpired = allEnriched.filter(j => j.lifecycle?.status === "expired");
  const allStale = allEnriched.filter(j => j.lifecycle?.status === "stale");

  return {
    scanned_at: scanData.scanned_at,
    total_scanned: rawJobs.length,
    counts: {
      total: rawJobs.length,
      active: activeEligible.length,
      saved: saved.length,
      applied: applied.length,
      not_interested: notInterested.length,
      expired: allExpired.length,
      stale: allStale.length,
      apply_now: activeQueue.apply.length,
      consider: activeQueue.consider.length,
      unevaluated: (activeQueue.unevaluated || []).length
    },
    queue: activeQueue,
    saved,
    applied,
    not_interested: notInterested,
    expired: allExpired,
    stale: allStale,
    all: allEnriched
  };
}

/**
 * Parses JSON request body.
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error(`Malformed JSON payload: ${e.message}`));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Creates the HTTP Request Handler.
 */
export function createRequestHandler() {
  return async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // CORS & Content-Type helpers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 1. GET /api/jobs
      if (pathname === "/api/jobs" && method === "GET") {
        const data = buildDashboardData();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
        return;
      }

      // 2. GET /api/state
      if (pathname === "/api/state" && method === "GET") {
        const state = loadApplicationState();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(state));
        return;
      }

      // 3. POST /api/state
      if (pathname === "/api/state" && method === "POST") {
        const payload = await parseRequestBody(req);
        const { jobId, status, notes } = payload;

        if (!jobId || typeof jobId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required string 'jobId'" }));
          return;
        }

        const normStatus = String(status || "").toLowerCase().trim();
        if (!VALID_STATUSES.has(normStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid status '${status}'. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}` }));
          return;
        }

        const result = setJobStatus(jobId, normStatus, { notes });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, result }));
        return;
      }

      // 4. GET /api/lifecycle
      if (pathname === "/api/lifecycle" && method === "GET") {
        const lifecycleState = loadJobLifecycleState();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(lifecycleState));
        return;
      }

      // 5. POST /api/lifecycle
      if (pathname === "/api/lifecycle" && method === "POST") {
        const payload = await parseRequestBody(req);
        const { jobId, status, notes } = payload;

        if (!jobId || typeof jobId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required string 'jobId'" }));
          return;
        }

        const normStatus = String(status || "").toLowerCase().trim();
        if (!VALID_LIFECYCLE_STATUSES.has(normStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid lifecycle status '${status}'. Must be one of: ${Array.from(VALID_LIFECYCLE_STATUSES).join(", ")}` }));
          return;
        }

        const result = setJobLifecycleStatus(jobId, normStatus, { source: "manual", notes });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, result }));
        return;
      }

      // 6. POST /api/pipeline/run
      if (pathname === "/api/pipeline/run" && method === "POST") {
        if (isPipelineRunning()) {
          res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Pipeline already running", status: getPipelineStatus() }));
          return;
        }
        const payload = await parseRequestBody(req).catch(() => ({}));
        // Trigger pipeline execution asynchronously
        runDailyPipeline({ ...payload, silent: true }).catch(err => {
          console.error(`Background daily pipeline error: ${err.message}`);
        });
        res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ message: "Daily pipeline started", status: getPipelineStatus() }));
        return;
      }

      // 5. GET /api/pipeline/status
      if (pathname === "/api/pipeline/status" && method === "GET") {
        const status = getPipelineStatus();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(status));
        return;
      }

      // 6. Static UI (GET / or /index.html)
      if (pathname === "/" || pathname === "/index.html" || pathname === "/dashboard") {
        if (!fs.existsSync(TEMPLATE_PATH)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Template dashboard.html not found.");
          return;
        }
        const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(template);
        return;
      }

      // 404 for other paths
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      console.error(`❌ HTTP Request Error: ${err.message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  };
}

/**
 * Starts the Dashboard server on an available port.
 */
export function startServer(port = DEFAULT_PORT, autoOpen = false) {
  return new Promise((resolve, reject) => {
    const handler = createRequestHandler();
    const server = http.createServer(handler);

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} is occupied, trying port ${port + 1}...`);
        startServer(port + 1, autoOpen).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`\n🚀 Career-Ops Dashboard running at: ${url}`);
      console.log(`   Press Ctrl+C to stop the dashboard server.\n`);

      if (autoOpen) {
        const openCmd = process.platform === "darwin" ? "open" :
                        process.platform === "win32" ? "start" : "xdg-open";
        exec(`${openCmd} "${url}"`, (err) => {
          if (err) {
            console.log(`Open ${url} in your browser.`);
          }
        });
      }

      resolve({ server, port, url });
    });
  });
}

// Auto-run if executed directly
if (process.argv[1] && (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) || process.argv[1].endsWith("dashboard-server.mjs"))) {
  const autoOpen = !process.argv.includes("--no-open");
  startServer(DEFAULT_PORT, autoOpen).catch(err => {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
}


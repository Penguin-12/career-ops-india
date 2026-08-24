#!/usr/bin/env node
/**
 * scripts/open-dashboard.mjs
 * Run: npm run dashboard
 *
 * Launches the local Career-Ops Dashboard server and opens it in your default browser.
 */

import { startServer } from "./dashboard-server.mjs";

const autoOpen = !process.argv.includes("--no-open");
const port = parseInt(process.env.PORT || "3000", 10);

startServer(port, autoOpen).catch(err => {
  console.error(`❌ Failed to start dashboard: ${err.message}`);
  process.exit(1);
});

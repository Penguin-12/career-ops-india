#!/usr/bin/env node
/**
 * scripts/evaluate.mjs — CLI for AI Job Evaluator
 * Usage:
 *   npm run evaluate
 *   npm run evaluate -- --limit=30
 *   npm run evaluate -- --limit=30 --concurrency=4
 *   npm run evaluate -- --limit=5 --dry-run
 *   npm run evaluate -- --limit=50 --force
 *   npm run evaluate -- --url="https://..."
 *   npm run evaluate -- --json
 */

import { evaluateBatch } from "./ai/evaluator.mjs";

const args = process.argv.slice(2);

function parseArg(name, defaultValue) {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(prefix)) {
      return args[i].substring(prefix.length);
    }
    if (args[i] === exact) {
      if (typeof defaultValue === "boolean") return true;
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        return args[i + 1];
      }
      return true;
    }
  }
  return defaultValue;
}

const limit = parseInt(parseArg("limit", "100"), 10);
const concurrency = parseInt(parseArg("concurrency", "3"), 10);
const timeout = parseInt(parseArg("timeout", "60"), 10);
const force = parseArg("force", false);
const dryRun = parseArg("dry-run", false) || parseArg("dryRun", false);
const jsonMode = parseArg("json", false);
const url = parseArg("url", null);
const company = parseArg("company", null);
const provider = parseArg("provider", null);
const source = parseArg("source", null);

async function main() {
  try {
    const result = await evaluateBatch({
      limit,
      concurrency,
      timeout,
      force,
      dryRun,
      json: jsonMode,
      url,
      company,
      provider,
      source
    });

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`\n❌ AI Evaluation failed: ${err.message}`);
    }
    process.exit(1);
  }
}

main();

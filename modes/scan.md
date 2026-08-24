# scan.md — Indian Company Portal Scanner
> Trigger: "scan", "find jobs", "what's new", /scan
> Load first: `_shared.md`, `config/profile.yml`, `portals/india.yml`

## How It Works
Queries Greenhouse/Lever/Ashby APIs of 60+ Indian companies directly.
No scraping. No bot detection. Clean JSON.
Run the actual scan: `node scripts/scan.mjs`
Then interpret `data/scan_results.json` and present results.

## Filtering Logic (from profile.yml)
- Title: job title contains a complete configured target-role phrase; broad
  single-word matches are not accepted.
- Level: manager, director, staff, lead, architect, and explicitly out-of-scope
  support/test titles are excluded.
- Location: matches a configured location (including Delhi NCR and Bangalore
  aliases), or is remote only when `Remote` is configured.
- Freshness: excludes postings without a valid date and postings older than
  `search.freshness_days`.
- Experience: when a JD explicitly states a years-of-experience range, it must
  overlap `search.experience_filter`; postings with no stated requirement remain
  available for evaluation.

## Output Format
```
## Scan Results — {date}
Companies scanned: {N} | Jobs found: {N} | Matching profile: {N}

### 🟢 New since last scan
[jobs not already in pipeline.json]

### 📋 Top Matches
| # | Company | Role | Location | Posted | Est. Grade | URL |
[ranked by estimated fit]

### ⚠️ Partial Matches (review manually)
[keyword match but title not exact]
```

## Post-Scan Actions
1. "Evaluate any of these? Give me the number."
2. "Add all estimated A/B to tracker as to_apply?"
3. "Want to scan with different keywords?"

## Score Estimation During Scan
These are estimates — run /evaluate for full scoring.
- ~A/B: exact title match + Tier 1 company + salary likely in range
- ~C: partial match or unknown company tier
- ~D/F: experience or location mismatch

## Adding Companies
If user says "add [company]":
1. Check careers page URL for ATS provider (greenhouse.io / lever.co / ashbyhq.com)
2. Find the slug
3. Add to `portals/india.yml`
4. Confirm: "Added [company] to scan list."

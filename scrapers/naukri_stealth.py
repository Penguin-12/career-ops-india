#!/usr/bin/env python3
"""
scrapers/naukri_stealth.py
Naukri scraper using Scrapling — the open-source anti-bot bypass tool.
Uses Camoufox (modified Firefox) to solve Cloudflare Turnstile.

Writes discovery jobs atomically to data/discovery_results.json.
Does NOT overwrite data/scan_results.json.
"""
import json, os, random, time, sys, tempfile, re
from datetime import datetime, timedelta
ROOT = Path(__file__).parent.parent

def read_config():
    p = ROOT / "config" / "profile.yml"
    if not p.exists():
        print("config/profile.yml not found. Copy from profile.example.yml")
        sys.exit(1)
    text = p.read_text(encoding="utf-8")
    roles, locations = [], []
    in_roles = in_locs = False
    min_lpa = 10
    for line in text.splitlines():
        if line.strip().startswith("target_roles:"):  in_roles=True;  in_locs=False;  continue
        if line.strip().startswith("locations:"):      in_locs=True;   in_roles=False; continue
        if in_roles and line.startswith("    - "): roles.append(line[6:].strip())
        elif in_roles and not line.startswith("    "): in_roles=False
        if in_locs  and line.startswith("    - "): locations.append(line[6:].strip())
        elif in_locs  and not line.startswith("    "): in_locs=False
        if "min:" in line:
            try: min_lpa = int(line.split(":")[1].strip())
            except: pass
    return {"roles": roles, "locations": locations, "min_lpa": min_lpa}

def build_url(role, page=1, min_lpa=10):
    slug = role.lower().strip().replace(" ", "-").replace("/", "-")
    salary = min_lpa * 100000
    start  = max(0, (page - 1) * 20)
    return f"https://www.naukri.com/{slug}-jobs?experience=0to2&jobAge=14&salary={salary}&start={start}"

def _first_el(node, *selectors):
    for sel in selectors:
    cards = []
    for sel in ["div.srp-jobtuple-wrapper", "div.cust-job-tuple", "article.jobTuple", 'li[class*="jobTupleHeader"]']:
        cards = page_obj.css(sel)
        if cards:
    if not cards:
        print("    No cards found — selectors may need updating or page is blocked.")
        try:
            title_el = _first_el(card, "a.title", "h2 a", 'a[class*="jobTitle"]', 'a[class*="title"]')
            if not title_el:
                continue
            title = title_el.text.strip() if title_el.text else ""
            url = title_el.attrib.get("href", "")
            if url and not url.startswith("http"):
                url = "https://www.naukri.com" + url
            if not title or not url:
                continue

            company = _first_text(card, "a.comp-name", "a.subTitle", 'a[class*="companyName"]', 'span[class*="companyName"]') or ""
            loc = _first_text(card, "span.locWdth", 'span[class*="loc"]')
            exp = _first_text(card, "span.expwdth", 'span[class*="exp"]')
            sal = _first_text(card, 'span[class*="sal"]', 'span[class*="salary"]')
            desc = _first_text(card, "span.job-desc", 'span[class*="job-desc"]', 'div[class*="job-desc"]')
            post_day = _first_text(card, "span.job-post-day", 'span[class*="post-day"]')
            job_id = card.attrib.get("data-job-id")

            # Parse posted_at if relative day string exists

def loc_match(job, locations):
    if not job.get("location") or not locations: return True
    loc = job["location"].lower()
    if "remote" in loc: return True
    return any(l.lower() in loc for l in locations)
def save_discovery_results(new_jobs):
    disc_path = ROOT / "data" / "discovery_results.json"
    disc_path.parent.mkdir(parents=True, exist_ok=True)
    existing_jobs = []
    if disc_path.exists():
        try:
            data = json.loads(disc_path.read_text(encoding="utf-8"))
    out_data = {
        "discovered_at": datetime.now().isoformat(),
        "jobs": combined
    }
    temp_file = disc_path.with_suffix(".tmp")
    temp_file.write_text(json.dumps(out_data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temp_file, disc_path)
    return len(combined)

def main():
    try:
        from scrapling.fetchers import StealthyFetcher
    except ImportError:
        print("\n❌ Scrapling not installed.")
        print("   pip install scrapling")
        print("   python -m playwright install firefox\n")
        sys.exit(1)

    cfg       = read_config()
    roles     = cfg["roles"]
    locations = cfg["locations"]
    min_lpa   = cfg["min_lpa"]

    all_jobs, seen = [], set()
    print("\n🔍 Naukri Discovery (Scrapling + StealthyFetcher — auto-bypasses Cloudflare)")
    print(f"   Roles: {', '.join(roles)}")
    print(f"   Tip: set headless=False below if you want to watch the browser\n")

    for role in roles:
        print(f"  Scraping: {role}")
        found = 0
        for page_num in range(1, 4):
            url = build_url(role, page=page_num, min_lpa=min_lpa)
            print(f"    Page {page_num}...")
            try:
                page = StealthyFetcher.fetch(
                    url,
                    headless=True,
                    humanize=True,
                    solve_cloudflare=True,
                    geoip=True,
                    os_randomize=True,
                    timeout=90000,
                    block_images=True,
                )
                txt = page.get_all_text().lower()
                if "access denied" in txt or "are you a robot" in txt:
                    print("    Blocked. Waiting 60s...")
                    time.sleep(60)
                    continue
                cards = parse_cards(page)
                for j in cards:
                    if not loc_match(j, locations): continue
                    key = f"{j['title'].lower()}|{j['company'].lower()}"
                    if key in seen: continue
                    seen.add(key); all_jobs.append(j); found += 1
                print(f"    {len(cards)} cards → {found} total matches")
                if len(cards) < 15: break
            except Exception as e:
                print(f"    Error: {str(e)[:80]}")
                break
            time.sleep(random.uniform(6, 12))
        print(f"  → {found} jobs for {role!r}")
        time.sleep(random.uniform(10, 18))

    total_in_file = save_discovery_results(all_jobs)
    print(f"\n{'─'*50}")
    print(f"✅ Naukri Discovery: {len(all_jobs)} jobs | Total discovery jobs: {total_in_file}")
    print(f"💾 Results saved to data/discovery_results.json")
    print(f"👉 Ingest into queue with: npm run ingest:discovery\n")

if __name__ == "__main__":
    main()

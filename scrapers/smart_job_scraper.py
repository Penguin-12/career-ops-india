#!/usr/bin/env python3
"""
scrapers/smart_job_scraper.py — Universal job scraper using ScrapeGraphAI

Extracts structured job data from any job page and saves to data/discovery_results.json.
Does NOT overwrite data/scan_results.json directly.
"""
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent

JOB_EXTRACTION_PROMPT = """
Extract job listing information from this page and return a JSON object with these exact fields:
{
  "title": "exact job title",
  "company": "company name",
  "location": "city/cities or Remote",
  "salary": "salary/CTC if mentioned, else null",
  "experience_required": "years required if mentioned, else null",
  "employment_type": "full-time/part-time/contract/internship",
  "remote": true or false,
  "apply_url": "direct application URL if different from current page, else null",
  "posted_date": "date if visible, else null",
  "description": "full job description text",
  "requirements": ["list of required skills/qualifications"],
  "responsibilities": ["list of key responsibilities"],
  "company_description": "brief company description if on page",
  "tech_stack": ["specific tools/technologies mentioned"]
}
If a field is not found, use null. Return ONLY the JSON object, no other text.
"""

EMAIL_EXTRACTION_PROMPT = """
Extract contact information for the data/analytics/product team or hiring contacts from this page.
Look for: team pages, about pages, leadership pages, hiring pages.
Return a JSON object:
{
  "contacts": [
    {
      "name": "full name",
      "title": "job title",
      "email": "email if visible",
      "linkedin": "linkedin URL if visible",
      "relevance": "hiring_manager/data_team_lead/recruiter/founder/other",
      "confidence": "high/medium/low"
    }
  ],
  "company_email_pattern": "pattern like firstname@company.com if detectable",
  "careers_email": "careers@company.com or similar if found"
}
Return ONLY the JSON object. If no contacts found, return {"contacts": [], "company_email_pattern": null, "careers_email": null}
"""


def get_llm_config() -> dict:
    gemini_key = os.environ.get("GEMINI_API_KEY")
    claude_key  = os.environ.get("ANTHROPIC_API_KEY")
    openai_key  = os.environ.get("OPENAI_API_KEY")

    if gemini_key:
        return {
            "llm": {
                "api_key": gemini_key,
                "model": "google_genai/gemini-2.0-flash",
            },
            "verbose": False,
            "headless": True,
        }
    elif claude_key:
        return {
            "llm": {
                "api_key": claude_key,
                "model": "anthropic/claude-haiku-4-5-20251001",
            },
            "verbose": False,
            "headless": True,
        }
    elif openai_key:
        return {
            "llm": {
                "api_key": openai_key,
                "model": "openai/gpt-4o-mini",
            },
            "verbose": False,
            "headless": True,
        }
    else:
        return {
            "llm": {
                "model": "ollama/llama3.2",
                "base_url": "http://localhost:11434",
            },
            "verbose": False,
            "headless": True,
        }


def scrape_job_url(url: str) -> dict:
    try:
        from scrapegraphai.graphs import SmartScraperGraph
    except ImportError:
        print("❌ ScrapeGraphAI not installed.")
        print("   pip install scrapegraphai && playwright install")
        sys.exit(1)

    config = get_llm_config()
    print(f"   Using LLM: {config['llm'].get('model', 'unknown')}")

    graph = SmartScraperGraph(
        prompt=JOB_EXTRACTION_PROMPT,
        source=url,
        config=config,
    )

    try:
        result = graph.run()
        if isinstance(result, str):
            result = json.loads(result)

        result["url"] = url
        result["source"] = "smart_scraper"
        result["source_type"] = "aggregator"
        result["scraped_at"] = datetime.now().isoformat()
        return result

    except Exception as e:
        print(f"   ⚠️  Extraction error: {e}")
        return {"url": url, "title": "", "company": "", "error": str(e)}


def save_to_discovery_results(raw_job: dict):
    disc_path = ROOT / "data" / "discovery_results.json"
    disc_path.parent.mkdir(parents=True, exist_ok=True)
    existing = {"jobs": []}
    if disc_path.exists():
        try:
            existing = json.loads(disc_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {"jobs": []}

    url = raw_job.get("url") or ""
    discovery_job = {
        "source": "smart_scraper",
        "source_type": "aggregator",
        "company": raw_job.get("company") or "Unknown",
        "title": raw_job.get("title") or "Unknown",
        "location": raw_job.get("location"),
        "url": url,
        "apply_url": raw_job.get("apply_url"),
        "posted_at": raw_job.get("posted_date"),
        "snippet": (raw_job.get("description") or "")[:500] if raw_job.get("description") else None,
        "salary": raw_job.get("salary"),
        "experience": raw_job.get("experience_required"),
        "source_job_id": None,
        "source_url": url,
        "remote": bool(raw_job.get("remote")),
        "employment_type": raw_job.get("employment_type"),
        "requirements": raw_job.get("requirements"),
        "tech_stack": raw_job.get("tech_stack"),
    }

    # Deduplicate by URL
    jobs_list = [j for j in existing.get("jobs", []) if j.get("url") != url]
    jobs_list.insert(0, discovery_job)
    
    out_data = {
        "discovered_at": datetime.now().isoformat(),
        "total": len(jobs_list),
        "jobs": jobs_list
    }

    temp_file = disc_path.with_suffix(".tmp")
    temp_file.write_text(json.dumps(out_data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temp_file, disc_path)
    print(f"   💾 Added to data/discovery_results.json (Run 'npm run ingest:discovery' to process)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scrapers/smart_job_scraper.py <URL>")
        print("Example: python scrapers/smart_job_scraper.py https://boards.greenhouse.io/razorpay/jobs/123")
        sys.exit(1)

    url = sys.argv[1]
    print(f"\n🔍 Smart Job Scraper (ScrapeGraphAI)\n   URL: {url}\n")

    job = scrape_job_url(url)

    if job.get("title"):
        print(f"\n✅ Extracted:")
        print(f"   Title:    {job.get('title')}")
        print(f"   Company:  {job.get('company')}")
        print(f"   Location: {job.get('location')}")
        print(f"   Salary:   {job.get('salary') or 'Not disclosed'}")
        print(f"   Stack:    {', '.join(job.get('tech_stack') or [])}")

        save_to_discovery_results(job)
    else:
        print(f"\n⚠️  Could not extract job data. Error: {job.get('error')}\n")

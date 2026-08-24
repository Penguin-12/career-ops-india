/**
 * scripts/ai/provider.mjs — AI Provider Abstraction & Model Response Parser
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/**
 * Extracts and validates strict JSON from raw model output
 */
export function parseModelJsonResponse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Empty or non-string output received from AI model");
  }

  let cleaned = rawText.trim();
  // Remove markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // If there's leading/trailing non-JSON text, extract the first outermost JSON object {...}
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI response as JSON: ${err.message}. Raw text: ${rawText.slice(0, 300)}...`);
  }

  // Validate and clamp dimension scores
  const technical_fit = Math.max(0, Math.min(25, Number(parsed.technical_fit) || 0));
  const experience_fit = Math.max(0, Math.min(20, Number(parsed.experience_fit) || 0));
  const stack_fit = Math.max(0, Math.min(20, Number(parsed.stack_fit) || 0));
  const career_trajectory = Math.max(0, Math.min(20, Number(parsed.career_trajectory) || 0));
  const application_probability = Math.max(0, Math.min(15, Number(parsed.application_probability) || 0));

  let ai_score = Number(parsed.ai_score);
  if (isNaN(ai_score) || ai_score < 0 || ai_score > 100) {
    ai_score = technical_fit + experience_fit + stack_fit + career_trajectory + application_probability;
  }
  ai_score = Math.round(ai_score);

  let recommendation = String(parsed.recommendation || "").toUpperCase().trim();
  if (!["APPLY", "CONSIDER", "SKIP"].includes(recommendation)) {
    if (ai_score >= 80) recommendation = "APPLY";
    else if (ai_score >= 70) recommendation = "CONSIDER";
    else recommendation = "SKIP";
  }

  let confidence = String(parsed.confidence || "").toUpperCase().trim();
  if (!["HIGH", "MEDIUM", "LOW"].includes(confidence)) {
    confidence = "HIGH";
  }

  return {
    ai_score,
    recommendation,
    confidence,
    technical_fit,
    experience_fit,
    stack_fit,
    career_trajectory,
    application_probability,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String) : [],
    why_apply: String(parsed.why_apply || ""),
    why_not: String(parsed.why_not || ""),
    resume_alignment: Array.isArray(parsed.resume_alignment) ? parsed.resume_alignment.map(String) : [],
    missing_requirements: Array.isArray(parsed.missing_requirements) ? parsed.missing_requirements.map(String) : []
  };
}

/**
 * Direct Gemini REST API Provider (uses GEMINI_API_KEY or GOOGLE_API_KEY)
 */
export class GeminiRestProvider {
  constructor(options = {}) {
    this.name = "gemini_rest";
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    this.model = options.model || DEFAULT_MODEL;
    if (!this.apiKey) {
      throw new Error("GeminiRestProvider requires GEMINI_API_KEY or GOOGLE_API_KEY");
    }
  }

  async generate(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini REST API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Gemini REST API returned no content in candidate response");
    }

    return parseModelJsonResponse(text);
  }
}

/**
 * Antigravity CLI Provider (agy)
 */
export class AgyCliProvider {
  constructor(options = {}) {
    this.name = "agy_cli";
    this.model = options.model || process.env.GEMINI_MODEL || "default";
  }

  async generate(prompt) {
    try {
      const args = ["-p", prompt, "--output-format", "text"];
      if (this.model && this.model !== "default" && this.model !== "gemini-2.0-flash") {
        args.push("--model", this.model);
      }
      const { stdout } = await execFileAsync("agy", args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 90000
      });
      return parseModelJsonResponse(stdout);
    } catch (err) {
      throw new Error(`AGY CLI evaluation failed: ${err.message}`);
    }
  }
}

/**
 * Gemini CLI Provider
 */
export class GeminiCliProvider {
  constructor(options = {}) {
    this.name = "gemini_cli";
    this.model = options.model || DEFAULT_MODEL;
  }

  async generate(prompt) {
    try {
      const args = ["-p", prompt, "-o", "json"];
      if (this.model && this.model !== "default") {
        args.push("-m", this.model);
      }
      const { stdout } = await execFileAsync("gemini", args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 90000
      });
      return parseModelJsonResponse(stdout);
    } catch (err) {
      throw new Error(`Gemini CLI evaluation failed: ${err.message}`);
    }
  }
}

/**
 * Mock Provider for offline testing and deterministic test suites
 */
export class MockProvider {
  constructor(mockFnOrResponse) {
    this.name = "mock";
    this.model = "mock-model-v1";
    this.mockFn = typeof mockFnOrResponse === "function"
      ? mockFnOrResponse
      : () => mockFnOrResponse || {
          ai_score: 92,
          recommendation: "APPLY",
          confidence: "HIGH",
          technical_fit: 23,
          experience_fit: 19,
          stack_fit: 19,
          career_trajectory: 18,
          application_probability: 13,
          strengths: ["Strong Kubernetes, microservices and Java experience", "Direct RAG & GenAI background"],
          gaps: ["No explicit Go production experience required in JD"],
          why_apply: "Direct architectural fit for platform engineering with excellent career upside.",
          why_not: "May require ramping up on secondary cloud services.",
          resume_alignment: ["Wells Fargo: 20+ microservices migration on OpenShift Kubernetes", "RAG indexing architecture"],
          missing_requirements: []
        };
  }

  async generate(prompt) {
    const res = await this.mockFn(prompt);
    if (typeof res === "string") {
      return parseModelJsonResponse(res);
    }
    return res;
  }
}

/**
 * Factory function: Selects the best available AI provider
 */
export function getAIProvider(options = {}) {
  if (options.provider === "mock" || options.mock) {
    return new MockProvider(options.mockResponse || options.mockFn);
  }

  const explicitKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (explicitKey && (options.provider === "gemini" || options.provider === "gemini_rest" || !options.provider)) {
    return new GeminiRestProvider({ apiKey: explicitKey, model: options.model });
  }

  if (options.provider === "gemini_cli") {
    return new GeminiCliProvider({ model: options.model });
  }

  // Default fallback to AGY CLI
  return new AgyCliProvider({ model: options.model });
}

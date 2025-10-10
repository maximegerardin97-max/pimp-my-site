// Kill Node.js polyfills that cause Deno issues - MUST BE FIRST
// deno-lint-ignore no-explicit-any
const __g: any = globalThis as any;
if (__g.process) { 
  try { 
    delete __g.process; 
  } catch { 
    __g.process = undefined; 
  } 
}
// Also kill other Node.js globals that cause issues
if (__g.setInterval) { try { delete __g.setInterval; } catch { __g.setInterval = undefined; } }
if (__g.setTimeout) { try { delete __g.setTimeout; } catch { __g.setTimeout = undefined; } }
if (__g.clearInterval) { try { delete __g.clearInterval; } catch { __g.clearInterval = undefined; } }
if (__g.clearTimeout) { try { delete __g.clearTimeout; } catch { __g.clearTimeout = undefined; } }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const SCREENSHOT_BUCKET = "screenshots"; // hardcoded
const PROMPT_PREFIX = Deno.env.get("PROMPT_PREFIX") || "";

const CORS_204 = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Max-Age": "86400",
};
const CORS_JSON = { ...CORS_204, "Content-Type": "application/json" };
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS_JSON });

// Direct Supabase API calls to avoid Node.js polyfills
const supabaseHeaders = {
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json'
};

async function supabaseRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { ...supabaseHeaders, ...options.headers }
  });
  return response.json();
}

async function supabaseStorageRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/storage/v1/object/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { ...supabaseHeaders, ...options.headers }
  });
  return response;
}

function extractJsonObject(text: string) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e < s) throw new Error("No JSON object found");
  return text.slice(s, e + 1);
}

function parseModelJson(text: string) {
  // Try multiple extraction methods
  const methods = [
    () => {
      const match = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      return match ? match[1] : null;
    },
    () => {
      const m = text.match(/\{[\s\S]*\}/);
      return m ? m[0] : null;
    },
    () => extractJsonObject(text),
    () => {
      const lines = text.split('\n');
      const jsonStart = lines.findIndex(line => line.trim().startsWith('{'));
      if (jsonStart === -1) return null;
      return lines.slice(jsonStart).join('\n');
    }
  ];

  for (const method of methods) {
    try {
      const jsonStr = method();
      if (!jsonStr) continue;
      const cleaned = jsonStr
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '"')
        .trim();
      const parsed = JSON.parse(cleaned);
      if (parsed) return parsed;
    } catch {
      // continue
    }
  }
  return null;
}

async function fetchStorageInline(path: string) {
  try {
    // Get public URL for storage object
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SCREENSHOT_BUCKET}/${path}`;
    console.log("Generated public URL:", publicUrl);
    
    // Test if the URL is accessible
    const testResponse = await fetch(publicUrl, { method: "HEAD" });
    console.log("URL accessibility test:", testResponse.status, testResponse.ok);
    
    if (!testResponse.ok) {
      console.log("Screenshot URL not accessible:", publicUrl);
      return null;
    }
    
    // Prefer URL source to avoid base64 dimension/size limits; Anthropic will fetch and handle resizing
    return { type: "image", source: { type: "url", url: publicUrl } };
  } catch (e) {
    console.log("Failed to process screenshot:", e);
    return null;
  }
}

async function callClaude(prompt: string, mediaParts: any[] = []) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  
  const content: any[] = [{ type: "text", text: prompt }];
  // Only include valid Anthropic image parts
  for (const p of mediaParts) {
    if (p && p.type === "image" && p.source && (p.source.type === "base64" || p.source.type === "url")) {
      content.push(p);
    }
  }
  
  console.log("Sending to Claude - Content parts:", content.length);
  console.log("Media parts received:", mediaParts.length);
  console.log("Content structure:", JSON.stringify(content, null, 2));
  
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 4000,
      temperature: 0,
      system: "You are a strict JSON generator. Output ONLY valid JSON, no prose or code fences.",
      messages: [
        { role: "user", content: content }
      ]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${JSON.stringify(body)}`);
  const parts = Array.isArray(body?.content) ? body.content : [];
  const text = parts.map((p: any) => p?.type === "text" ? p.text : "").join("\n").trim();
  return text;
}

function buildPrompt(ctx: any) {
  const ctxStr = JSON.stringify(ctx ?? {}, null, 2);
  return `${PROMPT_PREFIX}

Context:
${ctxStr}

You are analyzing a REAL website screenshot. Look at the actual visual elements, layout, colors, typography, and user interface in the provided image(s).

CRITICAL: Base your recommendations on what you ACTUALLY SEE in the screenshot, not generic advice.

MANDATORY: You MUST reference specific visual elements from the screenshot in your recommendations. If you cannot see the screenshot clearly, say so in your summary.

Analyze the specific visual elements you observe:
- What does the hero section look like?
- How is the navigation structured?
- What colors and typography are used?
- Are there any obvious usability issues?
- What specific UI elements need improvement?

Return ONLY JSON with exactly:
{
  "summary": "max 25 words",
  "recommendations_all": [
    { "id":"REC-1","category":"ui|ux|product","title":"max 8 words","impact":"high|medium|low","confidence":"high|medium|low","why_it_matters":"max 36 words","what_to_change":["max 18 words","max 18 words"],"acceptance_criteria":["max 18 words","max 18 words"],"analytics":["max 9 words"],"anchors":[] }
  ]
}

CRITICAL: Make recommendations DETAILED and ACTIONABLE. No generic advice.

For each recommendation:
- title: Specific, concrete action (e.g., "Add sticky CTA to product images" not "Improve buttons")
- why_it_matters: Specific business impact with metrics and detailed explanation (e.g., "Increases conversion by 15-25% based on ecommerce benchmarks because users can purchase without scrolling back to find the button")
- what_to_change: Exact UI elements to modify with implementation details (e.g., ["Add floating CTA button that appears after 50% scroll", "Implement size selector with visual feedback and hover states"])
- acceptance_criteria: Measurable outcomes with specific metrics (e.g., ["CTA visible on scroll after 50% page height", "Size selection completed in under 2 clicks with visual confirmation"])

Examples of GOOD vs BAD:
BAD: "Improve mobile responsiveness" (generic)
GOOD: "Fix overlapping text in mobile header that covers the logo" (specific to what you see)

BAD: "Better color scheme" (generic)  
GOOD: "Increase contrast between white text and light blue background in hero section" (specific to screenshot)

BAD: "Improve navigation" (generic)
GOOD: "Make navigation menu items larger and add hover states as they're too small to click easily" (specific to screenshot)

Hard constraints:
- recommendations_all has EXACTLY 7 items.
- Base EVERY recommendation on what you actually see in the provided screenshot(s).
- Be SPECIFIC about visual elements, colors, layout issues you observe in the image.
- Rank highest priority first. Priority = (impact high=3, medium=2, low=1) + (confidence high=0.3, medium=0.2, low=0.1). Sort DESC by score.
- Be SPECIFIC and ACTIONABLE. Give concrete, implementable changes with exact UI elements, components, or features to modify.
- JSON only. No code fences. No extra keys.
`;
}

async function insertAnalysis(parsed: any, url?: string, screenshotPaths?: string[]) {
  const analysisData = {
    input_url: url ?? null,
    screenshot_paths: screenshotPaths ?? [],
    summary: parsed?.summary ?? null,
    flow_app: null,
    flow_name: null,
    command: null,
    punchline: null,
    raw_model: parsed ?? null,
    status: "completed",
  };

  const analysis = await supabaseRequest("design_analyses", {
    method: "POST",
    body: JSON.stringify(analysisData),
    headers: { 'Prefer': 'return=representation' }
  });

  if (!analysis || !analysis[0]) throw new Error("Failed to insert analysis");
  const analysisId = analysis[0].id;

  const recsAll = Array.isArray(parsed?.recommendations_all) ? parsed.recommendations_all : [];
  if (recsAll.length) {
    const rows = recsAll.map((r: any) => ({
      analysis_id: analysisId,
      rec_key: r.id || `REC-${crypto.randomUUID().slice(0, 8)}`,
      category: r.category ?? null,
      title: r.title ?? null,
      impact: r.impact ?? null,
      confidence: r.confidence ?? null,
      why_it_matters: r.why_it_matters ?? null,
      what_to_change: r.what_to_change ?? [],
      acceptance_criteria: r.acceptance_criteria ?? [],
      analytics: r.analytics ?? [],
      anchors: r.anchors ?? [],
      votes: 0,
      is_active: true,
    }));
    
    await supabaseRequest("design_recommendations", {
      method: "POST",
      body: JSON.stringify(rows)
    });
  }
  return analysisId;
}

async function getAllActive(analysisId: string) {
  const data = await supabaseRequest(`design_recommendations?analysis_id=eq.${analysisId}&is_active=eq.true`);
  return data || [];
}

function priorityScore(impact?: string, confidence?: string) {
  const im = impact === "high" ? 3 : impact === "medium" ? 2 : 1;
  const cf = confidence === "high" ? 0.3 : confidence === "medium" ? 0.2 : 0.1;
  return im + cf;
}

async function getPayload(analysisId: string) {
  const a = await supabaseRequest(`design_analyses?id=eq.${analysisId}`);
  const all = await getAllActive(analysisId);

  const ranked = [...all].sort((x, y) => {
    const sx = priorityScore(x.impact, x.confidence);
    const sy = priorityScore(y.impact, y.confidence);
    return sy - sx;
  });
  const top3 = ranked.slice(0, 3);

  return {
    analysis_id: analysisId,
    summary: a?.[0]?.summary ?? "",
    recommendations: top3.map((r) => ({
      id: r.rec_key,
      category: r.category,
      title: r.title,
      impact: r.impact,
      confidence: r.confidence,
      why_it_matters: r.why_it_matters,
      what_to_change: r.what_to_change,
      acceptance_criteria: r.acceptance_criteria,
      analytics: r.analytics,
      anchors: r.anchors,
      votes: r.votes,
    })),
    recommendations_all: ranked.map((r) => ({
      id: r.rec_key,
      category: r.category,
      title: r.title,
      impact: r.impact,
      confidence: r.confidence,
      why_it_matters: r.why_it_matters,
      what_to_change: r.what_to_change,
      acceptance_criteria: r.acceptance_criteria,
      analytics: r.analytics,
      anchors: r.anchors,
      votes: r.votes,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_204 });
  if (req.method !== "POST") return ok({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      url,
      screenshotPath,
      screenshotPaths,
      context,
      action,
      rec_id,
      analysis_id,
    } = body || {};

    // Interactions
    if (action && analysis_id) {
      if (action === "upvote" && rec_id) {
        const row = await supabaseRequest(`design_recommendations?analysis_id=eq.${analysis_id}&rec_key=eq.${rec_id}`);
        const currentVotes = row?.[0]?.votes ?? 0;
        await supabaseRequest(`design_recommendations?analysis_id=eq.${analysis_id}&rec_key=eq.${rec_id}`, {
          method: "PATCH",
          body: JSON.stringify({ votes: currentVotes + 1 })
        });
        await supabaseRequest("design_interactions", {
          method: "POST",
          body: JSON.stringify({ analysis_id, rec_key: rec_id, action: "upvote", payload: null })
        });
        return ok(await getPayload(analysis_id), 200);
      }
      if (action === "downvote" && rec_id) {
        await supabaseRequest(`design_recommendations?analysis_id=eq.${analysis_id}&rec_key=eq.${rec_id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: false })
        });
        await supabaseRequest("design_interactions", {
          method: "POST",
          body: JSON.stringify({ analysis_id, rec_key: rec_id, action: "downvote", payload: null })
        });
        return ok(await getPayload(analysis_id), 200);
      }
      return ok(await getPayload(analysis_id), 200);
    }

    // Initial analysis
    const paths: string[] = Array.isArray(screenshotPaths)
      ? screenshotPaths
      : (screenshotPath ? [screenshotPath] : []);
    console.log("Screenshot paths:", paths);
    const mediaParts: any[] = [];
    for (const p of paths) {
      const inline = await fetchStorageInline(p);
      console.log("Processed screenshot:", p, "->", inline ? "SUCCESS" : "FAILED");
      if (inline) mediaParts.push(inline);
    }
    console.log("Media parts count:", mediaParts.length);

    const prompt = buildPrompt(context || {});
    const text = await callClaude(prompt, mediaParts);
    const parsed = parseModelJson(text);
    if (!parsed || !Array.isArray(parsed.recommendations_all) || parsed.recommendations_all.length !== 7) {
      return ok({ error: "Model did not return valid recommendations_all[7]." }, 500);
    }
    const analysisId = await insertAnalysis(parsed, url, paths);
    return ok(await getPayload(analysisId), 200);
  } catch (e) {
    console.error("analyze error", e);
    return ok({ error: String(e?.message || e) }, 500);
  }
});



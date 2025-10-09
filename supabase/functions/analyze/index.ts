// CORS: strict (OPTIONS 204), wildcard allow-origin on all JSON
// JWT verification: OFF
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY
// Optional: PROMPT_PREFIX

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.0?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") || "";
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
});

function extractJsonObject(text: string) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e < s) throw new Error("No JSON object found");
  return text.slice(s, e + 1);
}

function parseModelJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const cleaned = m[0]
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '"');
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const fallback = extractJsonObject(text)
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '"');
      return JSON.parse(fallback);
    } catch {
      return null;
    }
  }
}

async function fetchStorageInline(path: string) {
  try {
    const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) return null;
    const res = await fetch(data.publicUrl);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.byteLength; i++) s += String.fromCharCode(buf[i]);
    return { inline_data: { mime_type: mime, data: btoa(s) } };
  } catch {
    return null;
  }
}

async function callGemini(prompt: string, mediaParts: any[]) {
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");

  const contents = [{ role: "user", parts: [{ text: prompt }, ...mediaParts] }];

  const endpoints = [
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
    "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
  ];

  let last = "";
  for (const base of endpoints) {
    try {
      const res = await fetch(`${base}?key=${GOOGLE_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 3000 },
        }),
      });
      if (res.ok) {
        const body = await res.json();
        const text =
          body?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p?.text === "string")?.text || "";
        if (text) return text;
      } else {
        last = `${base}: ${res.status} ${await res.text().catch(() => "")}`;
        console.error("Gemini error:", last);
      }
    } catch (e) {
      last = `${base}: ${String((e as Error).message || e)}`;
      console.error("Gemini fetch error:", last);
    }
  }
  throw new Error(`All Gemini endpoints failed. Last: ${last}`);
}

function buildPrompt(ctx: any) {
  const ctxStr = JSON.stringify(ctx ?? {}, null, 2);
  return `${PROMPT_PREFIX}

Context:
${ctxStr}

You are a design analyst. Return ONLY a JSON with exactly this structure:

{
  "summary": "Brief 1–2 sentence summary",
  "recommendations": [
    {
      "id": "REC-1",
      "category": "ui|ux|product",
      "title": "Short actionable title",
      "impact": "high|medium|low",
      "confidence": "high|medium|low",
      "why_it_matters": "Conversion/usability rationale",
      "what_to_change": ["action 1", "action 2"],
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "analytics": ["metric 1", "metric 2"],
      "anchors": []
    },
    {
      "id": "REC-2",
      "category": "ui|ux|product",
      "title": "Short actionable title",
      "impact": "high|medium|low",
      "confidence": "high|medium|low",
      "why_it_matters": "Conversion/usability rationale",
      "what_to_change": ["action 1", "action 2"],
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "analytics": ["metric 1", "metric 2"],
      "anchors": []
    },
    {
      "id": "REC-3",
      "category": "ui|ux|product",
      "title": "Short actionable title",
      "impact": "high|medium|low",
      "confidence": "high|medium|low",
      "why_it_matters": "Conversion/usability rationale",
      "what_to_change": ["action 1", "action 2"],
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "analytics": ["metric 1", "metric 2"],
      "anchors": []
    }
  ]
}
`;
}

async function insertAnalysis(parsed: any, url?: string, screenshotPaths?: string[]) {
  const { data: analysis, error: aErr } = await supabase
    .from("design_analyses")
    .insert({
      input_url: url ?? null,
      screenshot_paths: screenshotPaths ?? [],
      summary: parsed?.summary ?? null,
      flow_app: null,
      flow_name: null,
      command: null,
      punchline: null,
      raw_model: parsed ?? null,
      status: "completed",
    })
    .select("*")
    .single();
  if (aErr) throw aErr;

  const recs = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
  if (recs.length) {
    const rows = recs.map((r: any) => ({
      analysis_id: analysis.id,
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
    const { error: rErr } = await supabase.from("design_recommendations").insert(rows);
    if (rErr) throw rErr;
  }
  return analysis.id as string;
}

async function getAnalysisPayload(analysisId: string) {
  const { data: a } = await supabase.from("design_analyses").select("*").eq("id", analysisId).single();
  const { data: recs } = await supabase
    .from("design_recommendations")
    .select("*")
    .eq("analysis_id", analysisId)
    .eq("is_active", true)
    .order("votes", { ascending: false });

  return {
    analysis_id: analysisId,
    summary: a?.summary ?? "",
    recommendations: (recs || []).map((r) => ({
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
        const { data: row } = await supabase
          .from("design_recommendations")
          .select("votes").eq("analysis_id", analysis_id).eq("rec_key", rec_id).single();
        await supabase
          .from("design_recommendations")
          .update({ votes: (row?.votes ?? 0) + 1 })
          .eq("analysis_id", analysis_id).eq("rec_key", rec_id);
        await supabase.from("design_interactions").insert({ analysis_id, rec_key: rec_id, action: "upvote", payload: null });
        return ok(await getAnalysisPayload(analysis_id), 200);
      }
      if (action === "downvote" && rec_id) {
        await supabase.from("design_recommendations")
          .update({ is_active: false })
          .eq("analysis_id", analysis_id).eq("rec_key", rec_id);

        const base = await getAnalysisPayload(analysis_id);
        const replacePrompt = `${PROMPT_PREFIX}
Replace ID "${rec_id}" with ONE new recommendation (no overlap).
Return: {"recommendations":[{...ONE...}]}
Existing: ${JSON.stringify(base.recommendations).slice(0, 4000)}
Context: ${JSON.stringify(context ?? {}, null, 2)}
`;
        const text = await callGemini(replacePrompt, []);
        const parsedReplace = parseModelJson(text);
        const newRec = Array.isArray(parsedReplace?.recommendations) ? parsedReplace.recommendations[0] : null;
        if (newRec) {
          await supabase.from("design_recommendations").insert({
            analysis_id,
            rec_key: newRec.id || `REC-${crypto.randomUUID().slice(0, 8)}`,
            category: newRec.category ?? null,
            title: newRec.title ?? null,
            impact: newRec.impact ?? null,
            confidence: newRec.confidence ?? null,
            why_it_matters: newRec.why_it_matters ?? null,
            what_to_change: newRec.what_to_change ?? [],
            acceptance_criteria: newRec.acceptance_criteria ?? [],
            analytics: newRec.analytics ?? [],
            anchors: newRec.anchors ?? [],
            votes: 0,
            is_active: true,
          });
        }
        await supabase.from("design_interactions").insert({ analysis_id, rec_key: rec_id, action: "downvote", payload: null });
        return ok(await getAnalysisPayload(analysis_id), 200);
      }
      return ok(await getAnalysisPayload(analysis_id), 200);
    }

    // Initial analysis
    const paths: string[] = Array.isArray(screenshotPaths)
      ? screenshotPaths
      : (screenshotPath ? [screenshotPath] : []);
    const mediaParts: any[] = [];
    for (const p of paths) {
      const inline = await fetchStorageInline(p);
      if (inline) mediaParts.push(inline);
    }

    const prompt = buildPrompt(context || {});
    const text = await callGemini(prompt, mediaParts);

    const parsed = parseModelJson(text);
    if (!parsed || !Array.isArray(parsed.recommendations)) {
      return ok({ error: "Model did not return valid recommendations JSON." }, 500);
    }

    const analysisId = await insertAnalysis(parsed, url, paths);
    return ok(await getAnalysisPayload(analysisId), 200);
  } catch (e) {
    console.error("analyze error", e);
    return ok({ error: String(e?.message || e) }, 500);
  }
});



// Deno Edge Function: scan
// - Accepts { url }
// - Generates a screenshot via ScreenshotOne API (or returns 501 if not configured)
// - Uploads to storage bucket `screenshots` at path scans/{scanId}/homepage.png
// - Inserts a row in table public.scans

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SCREENSHOTONE_ACCESS_KEY = Deno.env.get("SCREENSHOTONE_ACCESS_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.warn("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env for edge function");
}

// Helper to fetch a screenshot using ScreenshotOne: https://screenshotone.com/
async function takeScreenshot(url: string): Promise<Uint8Array> {
	if (!SCREENSHOTONE_ACCESS_KEY) {
		throw new Error(
			"SCREENSHOTONE_ACCESS_KEY not configured. Set it in your function env to enable screenshots."
		);
	}
	const apiUrl = new URL("https://api.screenshotone.com/take");
	apiUrl.searchParams.set("access_key", SCREENSHOTONE_ACCESS_KEY);
	apiUrl.searchParams.set("url", url);
	apiUrl.searchParams.set("full_page", "true");
	apiUrl.searchParams.set("format", "png");
	apiUrl.searchParams.set("viewport_width", "1440");
	apiUrl.searchParams.set("viewport_height", "900");
	apiUrl.searchParams.set("block_ads", "true");
	apiUrl.searchParams.set("block_cookie_banners", "true");

	const res = await fetch(apiUrl.toString());
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Screenshot API error: ${res.status} ${text}`);
	}
	const arrayBuffer = await res.arrayBuffer();
	return new Uint8Array(arrayBuffer);
}

Deno.serve(async (req) => {
	try {
		if (req.method !== "POST") {
			return new Response(JSON.stringify({ error: "Method not allowed" }), {
				status: 405,
				headers: { "content-type": "application/json" },
			});
		}
		const { url } = await req.json();
		if (!url || typeof url !== "string") {
			return new Response(JSON.stringify({ error: "Missing url" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}

		if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
			return new Response(JSON.stringify({ error: "Server not configured" }), {
				status: 500,
				headers: { "content-type": "application/json" },
			});
		}

		const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

		// Insert scan row first
		const { data: scanRow, error: insertErr } = await supabase
			.from("scans")
			.insert({ url, status: "processing" })
			.select()
			.single();
		if (insertErr || !scanRow) throw insertErr || new Error("Insert failed");

		let screenshotPath: string | null = null;
		try {
			const bytes = await takeScreenshot(url);
			screenshotPath = `scans/${scanRow.id}/homepage.png`;
			const { error: uploadErr } = await supabase.storage
				.from("screenshots")
				.upload(screenshotPath, bytes, {
					contentType: "image/png",
					upsert: true,
				});
			if (uploadErr) throw uploadErr;
			await supabase
				.from("scans")
				.update({ status: "completed", screenshot_paths: [screenshotPath] })
				.eq("id", scanRow.id);
		} catch (sErr) {
			await supabase
				.from("scans")
				.update({ status: "failed", error: String(sErr) })
				.eq("id", scanRow.id);
			throw sErr;
		}

		return new Response(
			JSON.stringify({ id: scanRow.id, screenshotPath }),
			{ status: 200, headers: { "content-type": "application/json" } }
		);
	} catch (e) {
		return new Response(JSON.stringify({ error: String(e) }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
	}
});

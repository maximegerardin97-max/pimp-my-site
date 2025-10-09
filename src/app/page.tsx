"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { getBrowserSupabaseClient } from "@/lib/supabaseClient";
import { ArrowRight, ThumbsUp, ThumbsDown, Download } from "lucide-react";

const schema = z.object({
  url: z.string().url("Enter a valid URL"),
  description: z
    .string()
    .min(5, "Add a short description of what this does"),
  improveArea: z.enum(["Looks", "UI", "UX", "Other"]),
  improveNotes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Recommendation = {
  id: string;
  title: string;
  explanation: string;
  votes: number;
  category?: string;
  impact?: string;
  confidence?: string;
  what_to_change?: string[];
  acceptance_criteria?: string[];
  analytics?: string[];
  anchors?: string[];
};

type Step = "scan" | "details" | "results";

export default function Home() {
  const supabase = useMemo(
    () => (typeof window !== "undefined" ? getBrowserSupabaseClient() : null),
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [moreRecs, setMoreRecs] = useState<Recommendation[]>([]);
  const [step, setStep] = useState<Step>("scan");
  const [scanInfo, setScanInfo] = useState<{ id: string; path?: string } | null>(
    null
  );
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    getValues,
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const handleScan = async () => {
    setError(null);
    setLoading(true);
    setRecs(null);
    try {
      if (!supabase) throw new Error("Client not ready");
      const url = getValues("url");
      if (!url) throw new Error("Enter a URL to scan");
      const { data, error: fnError } = await supabase.functions.invoke("scan", {
        body: { url },
      });
      if (fnError) throw fnError;
      const returnedPath: string | undefined =
        (data?.screenshotPath as string | undefined) ||
        (data?.screenshot_path as string | undefined) ||
        (data?.assets?.primary as string | undefined) ||
        (data?.path as string | undefined);
      setScanInfo({ id: data?.id, path: returnedPath });
      setStep("details");
    } catch (e: unknown) {
      const message =
        e instanceof Error
          ? e.message
          : "Scan failed. If this is on GitHub Pages, ensure the edge function has CORS and JWT disabled.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleImprove = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!supabase || !scanInfo?.path) {
        throw new Error("Missing scan result or Supabase client");
      }

      const values = getValues();
      const { data, error: fnError } = await supabase.functions.invoke("analyze", {
        body: {
          url: values.url,
          screenshotPath: scanInfo.path,
          context: {
            support: "website",
            industry: values.improveArea === "Other" ? "general" : "ecommerce",
            screen_purpose: values.improveArea === "UX" ? "user experience" : "product page",
            optimize_for: values.improveArea === "Looks" ? "visual appeal" : "conversion",
            expectation: values.improveNotes || "general"
          }
        }
      });

      if (fnError) throw fnError;

      // Transform the response to match our UI format
      const allIncoming: any[] = (data.recommendations_all || data.recommendations) || [];
      const transformedRecs: Recommendation[] = allIncoming.map((rec: any) => ({
        id: rec.id,
        title: rec.title,
        explanation: rec.why_it_matters,
        votes: rec.votes || 0,
        category: rec.category,
        impact: rec.impact,
        confidence: rec.confidence,
        what_to_change: rec.what_to_change,
        acceptance_criteria: rec.acceptance_criteria,
        analytics: rec.analytics,
        anchors: rec.anchors
      })) as Recommendation[];

      const firstThree = transformedRecs.slice(0, 3);
      const rest = transformedRecs.slice(3);
      setRecs(firstThree);
      setMoreRecs(rest);
      setAnalysisId(data.analysis_id);
      setStep("results");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Analysis failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpvote = async (recId: string) => {
    if (!supabase || !analysisId) return;
    
    try {
      const { data, error } = await supabase.functions.invoke("analyze", {
        body: {
          action: "upvote",
          rec_id: recId,
          analysis_id: analysisId
        }
      });
      
      if (error) throw error;
      
      // Update local state with new recommendations
      if (data.recommendations) {
        const transformedRecs = data.recommendations.map((rec: any) => ({
          id: rec.id,
          title: rec.title,
          explanation: rec.why_it_matters,
          votes: rec.votes || 0,
          category: rec.category,
          impact: rec.impact,
          confidence: rec.confidence,
          what_to_change: rec.what_to_change,
          acceptance_criteria: rec.acceptance_criteria,
          analytics: rec.analytics,
          anchors: rec.anchors
        }));
        setRecs(transformedRecs);
      }
    } catch (e) {
      console.error("Upvote failed:", e);
      // Fallback to local increment
      setRecs((prev) =>
        prev?.map((x) =>
          x.id === recId ? { ...x, votes: x.votes + 1 } : x
        ) ?? null
      );
    }
  };

  const handleDownvote = async (recId: string) => {
    if (!supabase || !analysisId) return;

    // Optimistic UI: remove the rec immediately and pull next from queue
    setRecs((prev) => {
      if (!prev) return prev;
      const remaining = prev.filter((x) => x.id !== recId);
      if (remaining.length < 3 && moreRecs.length > 0) {
        const [next, ...tail] = moreRecs;
        setMoreRecs(tail);
        return [...remaining, next];
      }
      return remaining;
    });

    // Fire-and-forget backend log (don't block UI)
    supabase.functions
      .invoke("analyze", {
        body: { action: "downvote", rec_id: recId, analysis_id: analysisId },
      })
      .catch((e) => console.error("Downvote log failed", e));
  };

  const exportPrompt = () => {
    const values = watch();
    const text = `Analyze the provided website screenshots and context, and propose top improvements.\nURL: ${values.url}\nDescription: ${values.description}\nFocus Area: ${values.improveArea}\nNotes: ${values.improveNotes ?? ""}`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lovable_prompt.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const gradientText =
    "bg-clip-text text-transparent bg-[radial-gradient(100%_100%_at_0%_0%,#A855F7_0%,transparent_50%),radial-gradient(100%_100%_at_100%_0%,#FF6B6B_0%,transparent_50%),radial-gradient(100%_100%_at_100%_100%,#F59E0B_0%,transparent_50%)]";

  return (
    <div className="px-6 md:px-10 lg:px-16 py-12 md:py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#A855F7] via-[#FF6B6B] to-[#F59E0B]" />
          <span className="text-lg font-semibold tracking-tight">Pimp My Site</span>
        </div>
        <div className="text-xs text-white/60">Powered by Supabase</div>
      </header>

      <main className="mt-16 md:mt-24 grid gap-12 md:gap-16 lg:grid-cols-2 items-start">
        <section>
          <h1 className={`text-4xl md:text-6xl font-bold leading-[1.05] ${gradientText}`}>
            Make your website instantly more lovable
          </h1>
          <p className="mt-5 text-white/70 max-w-xl">
            Paste your URL. We scan your site, then you add context, and we suggest improvements.
          </p>

          {/* Step 1: URL scan */}
          <div className="mt-8 p-4 md:p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
            <label className="text-sm text-white/70">Website URL</label>
            <div className="mt-2 flex gap-3">
              <input
                {...register("url")}
                placeholder="https://your-site.com"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 ring-purple-500/50"
              />
              <button
                type="button"
                onClick={handleScan}
                disabled={loading}
                className="shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-3 font-medium bg-gradient-to-r from-[#A855F7] via-[#FF6B6B] to-[#F59E0B] text-black hover:opacity-90 transition"
              >
                {loading && step === "scan" ? "Scanning..." : "Scan"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {errors.url && (
              <p className="mt-2 text-sm text-red-400">{errors.url.message}</p>
            )}
            {scanInfo?.path && (
              <p className="mt-2 text-xs text-white/60">Stored screenshot: {scanInfo.path}</p>
            )}
          </div>

          {/* Step 2: Context, only after successful scan */}
          {step !== "scan" && (
            <form className="mt-6 p-4 md:p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="text-sm text-white/70">What does this do?</label>
                  <textarea
                    {...register("description")}
                    rows={4}
                    placeholder="Describe your product or page"
                    className="mt-2 w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 ring-purple-500/50 resize-none"
                  />
                  {errors.description && (
                    <p className="mt-2 text-sm text-red-400">
                      {errors.description.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm text-white/70">
                    What do you want to improve?
                  </label>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {["Looks", "UI", "UX", "Other"].map((k) => (
                      <label
                        key={k}
                        className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm cursor-pointer hover:bg-white/10"
                      >
                        <input
                          type="radio"
                          value={k}
                          {...register("improveArea")}
                          className="accent-purple-500"
                        />
                        {k}
                      </label>
                    ))}
                  </div>
                  {errors.improveArea && (
                    <p className="mt-2 text-sm text-red-400">
                      {errors.improveArea.message}
                    </p>
                  )}
                  <textarea
                    {...register("improveNotes")}
                    rows={3}
                    placeholder="Add details about what to improve"
                    className="mt-3 w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 ring-purple-500/50 resize-none"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={handleImprove}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-gradient-to-r from-[#A855F7] via-[#FF6B6B] to-[#F59E0B] text-black"
                >
                  {loading && step === "details" ? "Analyzing..." : "Improve my design"}
                </button>
              </div>
            </form>
          )}

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </section>

        <section className="relative">
          <div className="absolute -inset-6 rounded-3xl bg-[radial-gradient(60%_60%_at_30%_10%,rgba(168,85,247,0.25),transparent_70%),radial-gradient(60%_60%_at_90%_20%,rgba(255,107,107,0.25),transparent_70%),radial-gradient(60%_60%_at_70%_90%,rgba(245,158,11,0.25),transparent_70%)] blur-2xl" />
          <div className="relative p-5 md:p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
            <h3 className="text-sm font-medium text-white/80">Recommendations</h3>
            {step !== "results" && (
              <p className="mt-3 text-white/60 text-sm">
                {step === "scan"
                  ? "Scan a site to get started."
                  : "Add context then click Improve my design."}
              </p>
            )}
            {recs && step === "results" && (
              <ul className="mt-4 space-y-4">
                {recs.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-medium">{r.title}</h4>
                        <p className="mt-1 text-sm text-white/70">
                          {r.explanation}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleUpvote(r.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" /> {r.votes}
                        </button>
                        <button
                          onClick={() => handleDownvote(r.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {step === "results" && (
              <div className="mt-6 flex justify-end">
                <button
                  onClick={exportPrompt}
                  disabled={!recs}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium bg-gradient-to-r from-[#A855F7] via-[#FF6B6B] to-[#F59E0B] text-black disabled:opacity-40"
                >
                  <Download className="h-4 w-4" /> Export prompt to Lovable
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="mt-16 text-center text-xs text-white/50">
        Built with ❤️ using Supabase
      </footer>
    </div>
  );
}

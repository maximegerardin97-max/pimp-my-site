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
  improveArea: z.enum(["Looks", "UI", "UX", "Other"], {
    required_error: "Pick an area to improve",
  }),
  improveNotes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type Recommendation = {
  id: string;
  title: string;
  explanation: string;
  votes: number;
};

export default function Home() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    setLoading(true);
    setRecs(null);
    try {
      const { error: fnError } = await supabase.functions.invoke("scan", {
        body: { url: values.url },
      });
      if (fnError) throw fnError;

      // Placeholder recommendations (agent to be implemented later)
      setRecs([
        {
          id: "rec-1",
          title: "Simplify UX for main flow",
          explanation:
            "Reduce the number of decision points on the landing and make primary CTA visible above the fold. Consider a guided stepper for the main action.",
          votes: 12,
        },
        {
          id: "rec-2",
          title: "Unify UI",
          explanation:
            "Adopt a consistent 8px spacing scale, align on typography (one display, one text family), and unify button sizes and corner radii.",
          votes: 8,
        },
        {
          id: "rec-3",
          title: "Improve visual hierarchy",
          explanation:
            "Use stronger contrast for headings, de-emphasize secondary actions, and introduce section dividers to guide scanning.",
          votes: 5,
        },
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
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
            Paste your URL. We scan your site, analyze the design, and generate
            actionable improvements you can ship today.
          </p>

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="mt-8 p-4 md:p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur"
          >
            <label className="text-sm text-white/70">Website URL</label>
            <div className="mt-2 flex gap-3">
              <input
                {...register("url")}
                placeholder="https://your-site.com"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 ring-purple-500/50"
              />
              <button
                type="submit"
                disabled={loading}
                className="shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-3 font-medium bg-gradient-to-r from-[#A855F7] via-[#FF6B6B] to-[#F59E0B] text-black hover:opacity-90 transition"
              >
                {loading ? "Scanning..." : "Scan"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {errors.url && (
              <p className="mt-2 text-sm text-red-400">{errors.url.message}</p>
            )}

            <div className="mt-6 grid gap-6 md:grid-cols-2">
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
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </form>
        </section>

        <section className="relative">
          <div className="absolute -inset-6 rounded-3xl bg-[radial-gradient(60%_60%_at_30%_10%,rgba(168,85,247,0.25),transparent_70%),radial-gradient(60%_60%_at_90%_20%,rgba(255,107,107,0.25),transparent_70%),radial-gradient(60%_60%_at_70%_90%,rgba(245,158,11,0.25),transparent_70%)] blur-2xl" />
          <div className="relative p-5 md:p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
            <h3 className="text-sm font-medium text-white/80">Recommendations</h3>
            {!recs && (
              <p className="mt-3 text-white/60 text-sm">
                Scan a site to generate recommendations.
              </p>
            )}
            {recs && (
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
                          onClick={() =>
                            setRecs((prev) =>
                              prev?.map((x) =>
                                x.id === r.id ? { ...x, votes: x.votes + 1 } : x
                              ) ?? null
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" /> {r.votes}
                        </button>
                        <button
                          onClick={() =>
                            setRecs((prev) => {
                              if (!prev) return prev;
                              // Replace with a new placeholder when downvoted
                              const replacement: Recommendation = {
                                id: `${r.id}-alt-${Math.random().toString(36).slice(2, 6)}`,
                                title: "Clarify CTA hierarchy",
                                explanation:
                                  "Make the primary action dominant and reduce secondary button emphasis. Use one vibrant gradient for the main CTA only.",
                                votes: 0,
                              };
                              return prev.map((x) => (x.id === r.id ? replacement : x));
                            })
                          }
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

            <div className="mt-6 flex justify-end">
              <button
                onClick={exportPrompt}
                disabled={!recs}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium bg-gradient-to-r from-[#A855F7] via-[#FF6B6B] to-[#F59E0B] text-black disabled:opacity-40"
              >
                <Download className="h-4 w-4" /> Export prompt to Lovable
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-16 text-center text-xs text-white/50">
        Built with ❤️ using Supabase
      </footer>
    </div>
  );
}

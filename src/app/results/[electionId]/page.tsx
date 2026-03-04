"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import confetti from "canvas-confetti";

// ─── Types ────────────────────────────────────────────────────────────────
type Candidate = { id: string; name: string; usn: string; voteCount: number };
type Position = {
  id: string;
  title: string;
  yearLabel: string;
  order: number;
  candidates: Candidate[];
  totalVotes: number;
};
type ResultsData = { electionTitle: string; positions: Position[] };

// ─── Confetti (Space Colors) ──────────────────────────────────────────────
function useSideConfetti() {
  return useCallback(() => {
    const end = Date.now() + 3 * 1000;
    const colors = ["#a786ff", "#fd8bbc", "#eca184", "#f8deb1"];

    const frame = () => {
      if (Date.now() > end) return;

      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        startVelocity: 60,
        origin: { x: 0, y: 0.6 },
        colors,
      });

      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        startVelocity: 60,
        origin: { x: 1, y: 0.6 },
        colors,
      });

      requestAnimationFrame(frame);
    };

    frame();
  }, []);
}

// ─── Main ──────────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const { electionId } = useParams<{ electionId: string }>();

  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  const launchConfetti = useSideConfetti();

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/admin/elections/${electionId}/results`);
        if (!r.ok) throw new Error("Results unavailable");
        setData(await r.json());
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [electionId]);

  const positions = useMemo(() => {
    if (!data) return [];
    return [...data.positions].reverse();
  }, [data]);

  const pos = positions[pageIdx];

  const { winners, isTie } = useMemo(() => {
    if (!pos || !pos.candidates.length) {
      return { winners: [], isTie: false };
    }

    // Uncontested: single candidate, treat as automatic winner
    if (pos.candidates.length === 1) {
      return { winners: pos.candidates, isTie: false };
    }

    const sorted = [...pos.candidates].sort(
      (a, b) => b.voteCount - a.voteCount,
    );

    const topVote = sorted[0].voteCount;
    const winners = sorted.filter((c) => c.voteCount === topVote);

    return { winners, isTie: winners.length > 1 };
  }, [pos]);

useEffect(() => {
  if (!started || !pos) return;
    launchConfetti();
}, [started, pageIdx]); // triggers on first reveal + page change

  const totalVotes = pos?.totalVotes ?? 0;

  // ─── Loading ────────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex gap-2">
          <div className="w-3 h-3 bg-cyan-500 rounded-full animate-bounce" />
          <div className="w-3 h-3 bg-cyan-500 rounded-full animate-bounce delay-150" />
          <div className="w-3 h-3 bg-cyan-500 rounded-full animate-bounce delay-300" />
        </div>
      </div>
    );

  if (error)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        🔒 Results Not Available
      </div>
    );

  if (!data)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        No Results Found
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      {/* Header */}
      <header className="text-center pt-16 pb-10 px-6">
        <div className="flex items-center justify-center gap-3 mb-4">
          <img
            src="/Aikya logo.png"
            className="w-10 h-10 object-contain"
            alt="Logo"
          />
          <span className="text-cyan-300 text-xs tracking-[0.4em] uppercase">
            Aikya Student Club · SMVITM
          </span>
        </div>

        <h1 className="text-4xl font-black">Election Results</h1>
        <p className="text-slate-400 text-sm">{data.electionTitle}</p>
      </header>

      {/* Start Button */}
      {!started && (
        <div className="flex flex-col items-center gap-6">
          <button
            onClick={() => {
              setStarted(true);
            }}
            className="px-8 py-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-black transition hover:scale-105"
          >
            Start Reveal
          </button>
        </div>
      )}

      {/* Results Card */}
      {started && pos && (
        <div className="max-w-3xl mx-auto px-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur transition-all duration-500">
            {/* Position */}
            <div className="px-6 py-4 border-b border-slate-800">
              <p className="text-cyan-400/70 text-xs uppercase">
                {pos.yearLabel}
              </p>
              <h2 className="text-xl font-black">{pos.title}</h2>
            </div>

            {/* Winner Section */}
            {winners.length > 0 && (
              <div className="px-6 py-6 bg-cyan-500/5">
                <p className="text-cyan-400 uppercase text-xs mb-4">
                  {isTie ? "Tie" : "Winner"}
                </p>

                {winners.map((w) => (
                  <div key={w.id} className="mb-4">
                    <p className="text-2xl font-black">{w.name}</p>
                    <p className="text-slate-400 text-sm">
                      {w.voteCount} votes
                    </p>

                    <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 transition-all duration-1000"
                        style={{
                          width: `${
                            totalVotes ? (w.voteCount / totalVotes) * 100 : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                ))}

                {isTie && (
                  <p className="text-xs text-slate-400 mt-3">
                    Multiple candidates received the highest number of votes.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            <button
              disabled={pageIdx === 0}
              onClick={() => setPageIdx((i) => i - 1)}
              className="px-6 py-3 border border-slate-700 rounded-xl disabled:opacity-30"
            >
              ← Back
            </button>

            <button
              disabled={pageIdx === positions.length - 1}
              onClick={() => {
                setPageIdx((i) => i + 1);
              }}
              className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl disabled:opacity-30"
            >
              Next ✨
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

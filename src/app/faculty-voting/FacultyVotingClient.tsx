"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Toaster, toast } from "react-hot-toast";

type Position = {
  id: string;
  title: string;
  candidates: Array<{ id: string; name: string; usn: string; voteCount: number }>;
};

type VotingData = {
  electionId: string;
  email: string;
  positions: Position[];
  hasVoted: boolean;
};

export default function FacultyVotingPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const electionId = searchParams.get("electionId");

  const [loading, setLoading] = useState(true);
  const [votingData, setVotingData] = useState<VotingData | null>(null);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !electionId) {
      setError("Missing voting token or election ID");
      setLoading(false);
      return;
    }

    fetchVotingData();
  }, [token, electionId]);

  const fetchVotingData = async () => {
    try {
      setLoading(true);
      const r = await fetch(
        `/api/faculty/vote?token=${token}&electionId=${electionId}`
      );

      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Failed to load voting data");
      }

      const data = await r.json();
      setVotingData(data);
      setError("");
    } catch (err: any) {
      setError(err.message);
      setVotingData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = (positionId: string, candidateId: string) => {
    setVotes(prev => ({
      ...prev,
      [positionId]: candidateId,
    }));
  };

  const handleSubmitVotes = async () => {
    if (!votingData || !token || !electionId) return;

    // Validate all positions have votes
    if (votingData.positions.length !== Object.keys(votes).length) {
      toast.error("Please vote for all positions");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/faculty/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          electionId,
          votingToken: token,
          votes,
        }),
      });

      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Failed to submit votes");
      }

      toast.success("✓ Vote recorded successfully!");
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d10] flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-2 justify-center mb-4">
            <div className="w-3 h-3 bg-[#fab900] rounded-full animate-bounce" />
            <div className="w-3 h-3 bg-[#fab900] rounded-full animate-bounce delay-150" />
            <div className="w-3 h-3 bg-[#fab900] rounded-full animate-bounce delay-300" />
          </div>
          <p className="text-slate-400">Loading voting positions...</p>
        </div>
      </div>
    );
  }

  if (error || !votingData) {
    return (
      <div className="min-h-screen bg-[#0d0d10] flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-red-950/20 border border-red-900/40 flex items-center justify-center mx-auto mb-4 text-3xl">
            🔒
          </div>
          <p className="text-white font-bold mb-2">Access Denied</p>
          <p className="text-slate-400 text-sm mb-6">
            {error || "Invalid voting link. Please check your email for the correct link."}
          </p>
          <a
            href="/"
            className="inline-block px-4 py-2 rounded-lg bg-[#fab900] hover:bg-[#ffd040] text-[#0d0d10] font-semibold transition-colors"
          >
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  const allVoted = votingData.positions.length === Object.keys(votes).length;

  return (
    <div className="min-h-screen bg-[#0d0d10] text-white">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-4">
            <img
              src="/Aikya logo.png"
              className="w-12 h-12 object-contain mx-auto mb-3"
              alt="Logo"
            />
            <h1 className="text-2xl font-black text-white">Faculty Vote</h1>
            <p className="text-slate-500 font-mono text-[10px] uppercase tracking-wider mt-2">
              Tie-Breaking Vote
            </p>
          </div>
          <div className="bg-slate-900/40 border border-[#fab900]/20 rounded-xl p-4">
            <p className="text-slate-400 text-xs font-mono">
              <span className="text-slate-600">Email:</span>{" "}
              <span className="text-[#fab900]">{votingData.email}</span>
            </p>
            <p className="text-slate-600 text-xs mt-2">
              You are voting on <span className="text-white font-bold">{votingData.positions.length}</span> position{votingData.positions.length !== 1 ? "s" : ""} with ties.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="space-y-6">
          {votingData.positions.map((position, posIdx) => {
            const selectedCandidate = votes[position.id];
            return (
              <div
                key={position.id}
                className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden"
              >
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/80">
                  <p className="text-white font-bold">{position.title}</p>
                  <p className="text-slate-500 font-mono text-xs mt-1">
                    {position.candidates.length} candidate{position.candidates.length !== 1 ? "s" : ""}
                  </p>
                </div>

                <div className="p-6 space-y-3">
                  {position.candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      onClick={() => handleVote(position.id, candidate.id)}
                      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                        selectedCandidate === candidate.id
                          ? "border-[#fab900] bg-[#fab900]/10"
                          : "border-slate-800 bg-slate-900/30 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selectedCandidate === candidate.id
                              ? "border-[#fab900] bg-[#fab900]"
                              : "border-slate-600"
                          }`}
                        >
                          {selectedCandidate === candidate.id && (
                            <div className="w-2 h-2 bg-[#0d0d10] rounded-full" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-white">{candidate.name}</p>
                          <p className="text-slate-500 font-mono text-xs">{candidate.usn}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-black text-[#fab900]">
                            {candidate.voteCount}
                          </p>
                          <p className="text-slate-600 font-mono text-[10px]">votes</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Submit Button */}
        <div className="mt-8 flex gap-3">
          <button
            onClick={handleSubmitVotes}
            disabled={!allVoted || submitting}
            className={`flex-1 py-3 rounded-lg font-bold transition-all ${
              allVoted && !submitting
                ? "bg-[#fab900] hover:bg-[#ffd040] text-[#0d0d10] cursor-pointer"
                : "bg-slate-800 text-slate-600 cursor-not-allowed"
            }`}
          >
            {submitting ? "Submitting..." : "Submit My Vote"}
          </button>
          <a
            href="/"
            className="px-6 py-3 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 font-semibold transition-colors"
          >
            Cancel
          </a>
        </div>

        {!allVoted && (
          <p className="text-amber-500/70 text-xs mt-4 text-center">
            ⚠ Please vote for all {votingData.positions.length} position{votingData.positions.length !== 1 ? "s" : ""} before submitting
          </p>
        )}
      </main>
    </div>
  );
}

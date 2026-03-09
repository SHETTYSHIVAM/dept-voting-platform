"use client";

import { useState, useEffect, useRef } from "react";
import { db, auth, loginWithGoogle } from "@/lib/firebase/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { Toaster, toast } from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/* ─────────────────────────────────────────────────────────── */
/* Types */
/* ─────────────────────────────────────────────────────────── */

type Role = {
  id: string;
  title: string;
  yearLabel?: string;
  candidates: { id: string; name: string; usn?: string }[];
};

type ElectionSummary = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed" | "results_published";
  votingStartsAt: string;
  votingEndsAt: string;
  hasVoted: boolean;
};

type UserDetails = {
  name: string;
  admissionYear: string;
  dept: string;
  rollNo: string;
};

type View = "loading" | "login" | "election-select" | "voting" | "success";

/* ─────────────────────────────────────────────────────────── */
/* Helpers */
/* ─────────────────────────────────────────────────────────── */

const isExpired = (el: ElectionSummary) =>
  el.status === "closed" ||
  el.status === "results_published" ||
  (el.status === "active" && new Date(el.votingEndsAt) < new Date());

const isUpcoming = (el: ElectionSummary) =>
  el.status === "draft" ||
  (el.status === "active" && new Date(el.votingStartsAt) > new Date());

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/* ─────────────────────────────────────────────────────────── */
/* Main Component */
/* ─────────────────────────────────────────────────────────── */

export function UnifiedElectionPage() {
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [elections, setElections] = useState<ElectionSummary[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedElection, setSelectedElection] =
    useState<ElectionSummary | null>(null);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [csrfToken, setCsrfToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ── Auth Listener ── */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setView("login");
        return;
      }

      setUser(u);

      const snap = await getDoc(doc(db, "users", u.uid));
      if (snap.exists()) {
        setUserDetails(snap.data() as UserDetails);
      }

      setView("election-select");
    });

    return () => unsub();
  }, []);

  /* ── Fetch Elections ── */

  const fetchElections = async () => {
    if (!user) return;

    setLoading(true);

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/elections", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const snap = await getDoc(doc(db, "users", user.uid));
      const votedMap = snap.data()?.hasVoted ?? {};

      setElections(
        data.elections
          .filter((e: any) => !e.isDeleted) // hide deleted for users
          .map((e: ElectionSummary) => ({
            ...e,
            hasVoted: !!votedMap[e.id],
          })),
      );
    } catch {
      toast.error("Failed to load elections");
    }

    setLoading(false);
  };

  useEffect(() => {
    if (view === "election-select" && user) fetchElections();
  }, [view, user]);

  /* ── Login ── */

  const handleGoogleLogin = async () => {
    setLoading(true);

    try {
      const u = await loginWithGoogle();
      const email = u.email || "";

      const match = email
        .toLowerCase()
        .match(/^([^.]+)\.(\d{2})([a-z]{2})(\d{3})@sode-edu\.in$/);

      if (!match) throw new Error("Use official SODE email.");

      const name = match[1];
      let yearSuffix = parseInt(match[2]);
      const branch = match[3];
      const rollNo = match[4];

      let admissionYear = parseInt("20" + yearSuffix);

      // Diploma students: roll starts with 4
      if (rollNo.startsWith("4")) {
        admissionYear -= 1;
      }

      const details = {
        uid: u.uid,
        name,
        admissionYear,
        dept: branch.toUpperCase(),
        rollNo,
        email,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "users", u.uid), details, { merge: true });
    } catch (e: any) {
      toast.error(e.message);
    }

    setLoading(false);
  };

  /* ── Select Election ── */

  const handleSelect = async (el: ElectionSummary) => {
    if (!user) return;

    setSelectedElection(el);
    setLoading(true);

    try {
      const token = await user.getIdToken();

      const [ballotRes, csrfRes] = await Promise.all([
        fetch(`/api/ballot?electionId=${el.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/auth/csrf"),
      ]);

      const ballot = await ballotRes.json();
      const csrf = await csrfRes.json();

      if (!ballotRes.ok) throw new Error(ballot.error);

      setRoles(ballot.roles);
      setCsrfToken(csrf.csrfToken);
      setView("voting");
    } catch (e: any) {
      toast.error(e.message);
      setSelectedElection(null);
    }

    setLoading(false);
  };

  /* ── Submit Vote ── */

  const submitVote = async () => {
    if (!user || !selectedElection) return;

    setSubmitting(true);

    try {
      const token = await user.getIdToken();

      const res = await fetch("/api/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          electionId: selectedElection.id,
          votes,
        }),
      });

      if (!res.ok) throw new Error("Submission failed");

      setView("success");
    } catch (e: any) {
      toast.error(e.message);
    }

    setSubmitting(false);
  };

  /* ─────────────────────────────────────────────────────────── */
  /* VIEWS */
  /* ─────────────────────────────────────────────────────────── */

  /* Loading */
  if (view === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-600 animate-bounce" />
          <div className="w-2 h-2 rounded-full bg-cyan-600 animate-bounce delay-150" />
          <div className="w-2 h-2 rounded-full bg-cyan-600 animate-bounce delay-300" />
        </div>
      </div>
    );
  }

  /* Login */
  if (view === "login") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <Card className="max-w-md w-full bg-slate-900 border-slate-800 text-white">
          <CardHeader>
            <CardTitle>Student Login</CardTitle>
            <CardDescription className="text-slate-400">
              Use your @sode-edu.in account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full bg-cyan-600 text-black hover:bg-cyan-500"
            >
              {loading ? "Verifying..." : "Login with Google"}
            </Button>
          </CardContent>
        </Card>
        <Toaster position="top-center" />
      </div>
    );
  }

  /* Election Select */
  if (view === "election-select") {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-3xl font-black">
            Hello, {userDetails?.name || "Student"}
          </h1>

          <div className="text-sm text-slate-400">
            {userDetails?.dept} • Batch {userDetails?.admissionYear}
          </div>

          {elections.map((el) => {
            const expired = isExpired(el);
            const upcoming = isUpcoming(el);

            const statusLabel = el.hasVoted
              ? "Voted"
              : el.status === "results_published"
                ? "Results Published"
                : expired
                  ? "Election Ended"
                  : upcoming
                    ? "Upcoming"
                    : "Pending";

            const statusColor = el.hasVoted
              ? "bg-emerald-600"
              : el.status === "results_published"
                ? "bg-cyan-700"
                : expired
                  ? "bg-slate-600"
                  : upcoming
                    ? "bg-blue-600"
                    : "bg-yellow-500 text-black";

            return (
              <div
                key={el.id}
                onClick={() =>
                  !el.hasVoted &&
                  !expired &&
                  el.status === "active" &&
                  handleSelect(el)
                }
                className={`p-6 rounded-2xl border transition space-y-3
        ${
          el.hasVoted
            ? "border-emerald-800 bg-emerald-950/10"
            : expired
              ? "border-slate-800 bg-slate-900/30 opacity-70 cursor-not-allowed"
              : "border-slate-800 hover:border-cyan-500 cursor-pointer"
        }`}
              >
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-lg">{el.title}</h3>
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold ${statusColor}`}
                  >
                    {statusLabel}
                  </span>
                </div>

                <div className="text-xs text-slate-400">
                  {formatDate(el.votingStartsAt)} →{" "}
                  {formatDate(el.votingEndsAt)}
                </div>
                {el.status === "results_published" && (
                  <a
                    href={`results/${el.id}`}
                    className="text-sm text-cyan-400 font-medium"
                  >
                    🎉 Results are live — click to view
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <Toaster />
      </div>
    );
  }

  /* Voting */
  if (view === "voting" && selectedElection) {
    const currentRole = roles[step];
    const review = step === roles.length;
    console.log(currentRole);

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-white">
        <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="text-xs text-slate-400">
            Voting Ends: {formatDate(selectedElection.votingEndsAt)}
          </div>
          {!review ? (
            <>
              <div className="text-xs text-slate-400">
                Position {step + 1} of {roles.length}
              </div>
              <h2 className="text-2xl font-black">{currentRole.title}</h2>

              {currentRole.yearLabel && (
                <p className="text-sm text-slate-400">
                  Position Year: {currentRole.yearLabel}
                </p>
              )}

              <RadioGroup
                value={votes[currentRole.id] ?? ""}
                onValueChange={(v) =>
                  setVotes((prev) => ({
                    ...prev,
                    [currentRole.id]: v,
                  }))
                }
                className="space-y-3"
              >
                {currentRole.candidates.map((c) => {
                  const selected = votes[currentRole.id] === c.id;

                  return (
                    <div
                      key={c.id}
                      onClick={() =>
                        setVotes((prev) => ({
                          ...prev,
                          [currentRole.id]: c.id,
                        }))
                      }
                      className={`flex items-center gap-4 p-4 border rounded-xl cursor-pointer transition
        ${
          selected
            ? "border-cyan-500 bg-cyan-600/10"
            : "border-slate-800 hover:border-cyan-500"
        }
      `}
                    >
                      <RadioGroupItem value={c.id} id={c.id} />
                      <span className="flex-1">
                        {c.name}
                        {c.usn && (
                          <span className="block text-xs text-slate-400">
                            {c.usn}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </RadioGroup>

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  disabled={step === 0}
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>

                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={!votes[currentRole.id]}
                  className="bg-cyan-600 text-black hover:bg-cyan-500"
                >
                  {step === roles.length - 1 ? "Review" : "Next"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-black">Review Ballot</h2>

              <div className="space-y-2">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    className="flex justify-between border-b border-slate-800 py-2 text-sm"
                  >
                    <span>{r.title}</span>
                    <span>
                      {r.candidates.find((c) => c.id === votes[r.id])?.name}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(roles.length - 1)}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={submitVote}
                  disabled={submitting}
                  className="flex-1 bg-cyan-600 text-black hover:bg-cyan-500"
                >
                  {submitting ? "Submitting..." : "Confirm Vote"}
                </Button>
              </div>
            </>
          )}
        </div>

        <Toaster />
      </div>
    );
  }

  /* Success */
  if (view === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white text-center p-6">
        <div className="space-y-4">
          <h2 className="text-4xl font-black text-cyan-300">Vote Recorded</h2>
          <p>Your vote was securely submitted.</p>
          <Button
            onClick={() => {
              setView("election-select");
              fetchElections();
            }}
            className="bg-cyan-600 text-black hover:bg-cyan-500"
          >
            Back to Elections
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { Toaster, toast } from "react-hot-toast";
import { isAdmin } from "@/lib/admin-utils";

// ─── Types ────────────────────────────────────────────────────────────────────
type Candidate = { id: string; name: string; usn: string; bio?: string; voteCount?: number };
type Position  = { id: string; title: string; yearLabel: string; order: number; candidates: Candidate[] };
type Election  = {
  id: string; title: string; status: "draft" | "active" | "closed" | "results_published";
  votingStartsAt: string; votingEndsAt: string;
  resultsPublished: boolean; totalVoters?: number;
  eligibleAdmissionYears?: number[];
  positions?: Position[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (iso: string) => iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const toInputVal = (iso: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};
const fromInputVal = (val: string) => {
  if (!val) return "";
  const date = new Date(val);
  return date.toISOString();
};
const STATUS_COLOR: Record<string, string> = {
  draft: "text-slate-400 bg-slate-800",
  active: "text-emerald-400 bg-emerald-950",
  closed: "text-red-400 bg-red-950",
  results_published: "text-[#fab900] bg-amber-950",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  results_published: "Results Published",
};

// Generate a range of admission years (current year - 4 to current year)
const CURRENT_YEAR = new Date().getFullYear();
const ADMISSION_YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// ─── Confirm Dialog ───────────────────────────────────────────────────────────
type ConfirmConfig = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

function ConfirmDialog({ config, onClose }: { config: ConfirmConfig; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-700 bg-[#131318] shadow-2xl shadow-black/60 p-6 space-y-5">
        <div className="space-y-1.5">
          <p className="text-white font-bold text-base tracking-tight">{config.title}</p>
          <p className="text-slate-400 text-sm leading-relaxed whitespace-pre-line">{config.message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-sm font-semibold transition-all">
            Cancel
          </button>
          <button onClick={() => { config.onConfirm(); onClose(); }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all
              ${config.danger
                ? "bg-red-600 hover:bg-red-500 text-white border border-red-500"
                : "bg-[#fab900] hover:bg-[#ffd040] text-[#0d0d10] border border-[#fab900]"
              }`}>
            {config.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [config, setConfig] = useState<ConfirmConfig | null>(null);
  const confirm = (cfg: ConfirmConfig) => setConfig(cfg);
  const close   = () => setConfig(null);
  const dialog  = config ? <ConfirmDialog config={config} onClose={close} /> : null;
  return { confirm, dialog };
}

// ─── Admission Year Picker ────────────────────────────────────────────────────
function AdmissionYearPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (years: number[]) => void;
}) {
  const toggle = (year: number) => {
    if (selected.includes(year)) {
      onChange(selected.filter(y => y !== year));
    } else {
      onChange([...selected, year].sort((a, b) => b - a));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ADMISSION_YEAR_OPTIONS.map(year => {
          const isSelected = selected.includes(year);
          return (
            <button
              key={year}
              type="button"
              onClick={() => toggle(year)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all
                ${isSelected
                  ? "bg-[#fab900] border-[#fab900] text-[#0d0d10]"
                  : "bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                }`}
            >
              {year}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-amber-500/70 font-mono text-[10px]">⚠ No admission years selected — all voters will be blocked</p>
      )}
      {selected.length > 0 && (
        <p className="text-slate-600 font-mono text-[10px]">
          {selected.length} year{selected.length !== 1 ? "s" : ""} eligible: {selected.join(", ")}
        </p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [user, setUser]               = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [idToken, setIdToken]         = useState("");
  const [tab, setTab]                 = useState<"elections" | "candidates" | "results">("elections");
  const [elections, setElections]     = useState<Election[]>([]);
  const [selectedElection, setSelectedElection] = useState<Election | null>(null);
  const [loading, setLoading]         = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [eForm, setEForm] = useState({
    title: "",
    votingStartsAt: "",
    votingEndsAt: "",
    eligibleAdmissionYears: [] as number[],
  });
  const [editingElection, setEditingElection] = useState<string | null>(null);

  const [cForm, setCForm] = useState({ name: "", usn: "", bio: "" });
  const [editingCandidate, setEditingCandidate] = useState<{ positionId: string; candidateId: string } | null>(null);
  const [activePosId, setActivePosId] = useState<string>("");

  const [results, setResults] = useState<Position[]>([]);
  const [selectedResultElectionId, setSelectedResultElectionId] = useState<string>("");
  const [facultyInput, setFacultyInput] = useState("");
  const [facultyStatus, setFacultyStatus] = useState<{ totalVoters: number; votedCount: number; pendingCount: number } | null>(null);
  const [showFacultyForm, setShowFacultyForm] = useState(false);

  const { confirm, dialog: confirmDialog } = useConfirm();

const router = useRouter();

useEffect(() => {
  return onAuthStateChanged(auth, async (u) => {
    setUser(u);

    if (!u) {
      setAuthLoading(false);
      return;
    }

    const token = await u.getIdToken();
    setIdToken(token);

    try {
      const res = await fetch("/api/admin/check", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      setIsAdminUser(data.isAdmin);
      setAdminChecked(true);
    } catch {
      setIsAdminUser(false);
      setAdminChecked(true);
    }

    setAuthLoading(false);
  });
}, []);

useEffect(() => {
  if (adminChecked && !isAdminUser) {
    toast.error("Not authorised", { duration: 2000 });
    router.push("/");
  }
}, [adminChecked, isAdminUser, router]);

  const hdr = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  }), [idToken]);

  const fetchElections = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/elections", { headers: hdr() });
      const d = await r.json();
      setElections(d.elections ?? []);
    } catch { toast.error("Failed to load elections"); }
    finally { setLoading(false); }
  }, [hdr]);

  useEffect(() => { if (idToken) fetchElections(); }, [idToken, fetchElections]);

  const selectElection = async (el: Election) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/elections/${el.id}`, { headers: hdr() });
      const d = await r.json();
      setSelectedElection(d.election);
      if (d.election.positions?.length) setActivePosId(d.election.positions[0].id);
      setTab("candidates");
    } catch { toast.error("Failed to load election details"); }
    finally { setLoading(false); }
  };

  const saveElection = async () => {
    if (!eForm.title || !eForm.votingStartsAt || !eForm.votingEndsAt) {
      toast.error("Fill all fields"); return;
    }
    if (eForm.eligibleAdmissionYears.length === 0) {
      toast.error("Select at least one eligible admission year"); return;
    }
    
    confirm({
      title: editingElection ? "Update Election" : "Create Election",
      message: editingElection 
        ? `Save changes to "${eForm.title}"?`
        : `Create election "${eForm.title}"?\n\nStart: ${fmt(fromInputVal(eForm.votingStartsAt))}\nEnd: ${fmt(fromInputVal(eForm.votingEndsAt))}`,
      confirmLabel: editingElection ? "Update" : "Create",
      onConfirm: () => doSaveElection(),
    });
  };

  const doSaveElection = async () => {
    setLoading(true);
    try {
      const url    = editingElection ? `/api/admin/elections/${editingElection}` : "/api/admin/elections";
      const method = editingElection ? "PUT" : "POST";
      const payload = {
        ...eForm,
        votingStartsAt: fromInputVal(eForm.votingStartsAt),
        votingEndsAt: fromInputVal(eForm.votingEndsAt),
      };
      const r = await fetch(url, { method, headers: hdr(), body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json()).error);
      toast.success(editingElection ? "Election updated" : "Election created");
      setEForm({ title: "", votingStartsAt: "", votingEndsAt: "", eligibleAdmissionYears: [] });
      setEditingElection(null);
      fetchElections();
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const deleteElection = (id: string, title: string) => {
    confirm({
      title: "Delete Election",
      message: `Are you sure you want to permanently delete "${title}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        setLoading(true);
        try {
          await fetch(`/api/admin/elections/${id}`, { method: "DELETE", headers: hdr() });
          toast.success("Deleted"); fetchElections();
        } catch { toast.error("Delete failed"); }
        finally { setLoading(false); }
      },
    });
  };

  const updateStatus = (id: string, action: "start" | "end" | "publish", electionTitle: string, election?: Election) => {
    // Check if voting can start
    if (action === "start" && election) {
      // If positions aren't loaded, fetch the full election first
      if (!election.positions) {
        setLoading(true);
        fetch(`/api/admin/elections/${id}`, { headers: hdr() })
          .then(r => r.json())
          .then(d => {
            const fullElection = d.election;
            const hasPositions = fullElection.positions && fullElection.positions.length > 0;
            const hasAllCandidates = fullElection.positions?.every((pos: Position) => pos.candidates && pos.candidates.length > 0) ?? false;
            
            if (!hasPositions || !hasAllCandidates) {
              const missingInfo = [];
              if (!hasPositions) missingInfo.push("No positions configured");
              else if (!hasAllCandidates) missingInfo.push("Some positions have no candidates");
              
              confirm({
                title: "Cannot Start Voting",
                message: `⚠ The following must be completed before starting:\n\n${missingInfo.map(m => `• ${m}`).join("\n")}`,
                confirmLabel: "Go to Candidates",
                onConfirm: () => selectElection(fullElection),
              });
              setLoading(false);
              return;
            }
            
            // Positions and candidates are valid, proceed with status update
            proceedWithStatusUpdate(id, action, electionTitle);
          })
          .catch(() => {
            toast.error("Failed to verify positions");
            setLoading(false);
          });
        return;
      }
      
      const hasPositions = election.positions && election.positions.length > 0;
      const hasAllCandidates = election.positions?.every(pos => pos.candidates && pos.candidates.length > 0) ?? false;
      
      if (!hasPositions || !hasAllCandidates) {
        const missingInfo = [];
        if (!hasPositions) missingInfo.push("No positions configured");
        else if (!hasAllCandidates) missingInfo.push("Some positions have no candidates");
        
        confirm({
          title: "Cannot Start Voting",
          message: `⚠ The following must be completed before starting:\n\n${missingInfo.map(m => `• ${m}`).join("\n")}`,
          confirmLabel: "Go to Candidates",
          onConfirm: () => selectElection(election),
        });
        return;
      }
    }

    proceedWithStatusUpdate(id, action, electionTitle);
  };

  const proceedWithStatusUpdate = (id: string, action: "start" | "end" | "publish", electionTitle: string) => {
    const actionMeta: Record<string, { title: string; message: string; label: string; danger?: boolean }> = {
      start: {
        title: "Start Voting",
        message: `Start voting for "${electionTitle}"? Voters will be able to cast their votes once started.`,
        label: "Start Voting",
      },
      end: {
        title: "End Voting",
        message: `End voting for "${electionTitle}"? No more votes can be cast after this.`,
        label: "End Voting",
        danger: true,
      },
      publish: {
        title: "Publish Results",
        message: `Publish results for "${electionTitle}"? Results will become visible to all voters.`,
        label: "Publish Results",
      },
    };

    const meta = actionMeta[action];
    confirm({
      title: meta.title,
      message: meta.message,
      confirmLabel: meta.label,
      danger: meta.danger,
      onConfirm: async () => {
        setLoading(true);
        try {
          const r = await fetch(`/api/admin/elections/${id}/status`, {
            method: "POST", headers: hdr(), body: JSON.stringify({ action }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          toast.success(`Election ${action === "publish" ? "results published" : action + "ed"}`);
          fetchElections();
          if (selectedElection?.id === id) selectElection({ ...selectedElection, id });
        } catch (e: any) { toast.error(e.message); }
        finally { setLoading(false); }
      },
    });
  };

  const extendTiming = (id: string, newStart: string, newEnd: string, electionTitle: string) => {
    confirm({
      title: "Adjust Timing",
      message: `Update voting schedule for "${electionTitle}"?\n\nNew start: ${fmt(fromInputVal(newStart))}\nNew end: ${fmt(fromInputVal(newEnd))}`,
      confirmLabel: "Apply Changes",
      onConfirm: async () => {
        setLoading(true);
        try {
          const r = await fetch(`/api/admin/elections/${id}/timing`, {
            method: "PATCH", headers: hdr(),
            body: JSON.stringify({ votingStartsAt: fromInputVal(newStart), votingEndsAt: fromInputVal(newEnd) }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          toast.success("Timing updated"); fetchElections();
        } catch (e: any) { toast.error(e.message); }
        finally { setLoading(false); }
      },
    });
  };

  const saveCandidate = () => {
    if (!selectedElection || !activePosId) return;
    if (!cForm.name || !cForm.usn) { toast.error("Name and USN required"); return; }

    const activePos = selectedElection.positions?.find(p => p.id === activePosId);

    if (editingCandidate) {
      confirm({
        title: "Update Candidate",
        message: `Save changes to "${cForm.name}" (${cForm.usn.toUpperCase()}) in ${activePos?.title ?? "this position"}?`,
        confirmLabel: "Update",
        onConfirm: () => doSaveCandidate(),
      });
    } else {
      doSaveCandidate();
    }
  };

  const doSaveCandidate = async () => {
    if (!selectedElection || !activePosId) return;
    setLoading(true);
    try {
      const url    = editingCandidate
        ? `/api/admin/elections/${selectedElection.id}/positions/${editingCandidate.positionId}/candidates/${editingCandidate.candidateId}`
        : `/api/admin/elections/${selectedElection.id}/positions/${activePosId}/candidates`;
      const method = editingCandidate ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: hdr(), body: JSON.stringify(cForm) });
      if (!r.ok) throw new Error((await r.json()).error);
      toast.success(editingCandidate ? "Candidate updated" : "Candidate added");
      setCForm({ name: "", usn: "", bio: "" }); setEditingCandidate(null);
      // Refresh election data while preserving current position selection
      const freshData = await fetch(`/api/admin/elections/${selectedElection.id}`, { headers: hdr() }).then(r => r.json());
      setSelectedElection(freshData.election);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const deleteCandidate = (posId: string, candId: string, candidateName: string, positionTitle: string) => {
    if (!selectedElection) return;
    confirm({
      title: "Remove Candidate",
      message: `Remove "${candidateName}" from ${positionTitle}? This cannot be undone.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        setLoading(true);
        try {
          await fetch(`/api/admin/elections/${selectedElection.id}/positions/${posId}/candidates/${candId}`, {
            method: "DELETE", headers: hdr()
          });
          toast.success("Removed");
          // Refresh election data while preserving current position selection
          const freshData = await fetch(`/api/admin/elections/${selectedElection.id}`, { headers: hdr() }).then(r => r.json());
          setSelectedElection(freshData.election);
        } catch { toast.error("Delete failed"); }
        finally { setLoading(false); }
      },
    });
  };

  const fetchResults = async (electionId: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/elections/${electionId}/results`, { headers: hdr() });
      const d = await r.json();
      setResults(d.positions ?? []);
      setSelectedResultElectionId(electionId);
      setFacultyStatus(null);
      setShowFacultyForm(false);
      setTab("results");
      // Fetch faculty voting status
      fetchFacultyStatus(electionId);
    } catch { toast.error("Failed to load results"); }
    finally { setLoading(false); }
  };

  const fetchFacultyStatus = async (electionId: string) => {
    try {
      const r = await fetch(`/api/admin/elections/${electionId}/faculty`, { headers: hdr() });
      if (r.ok) {
        const d = await r.json();
        setFacultyStatus(d);
      }
    } catch {
      // Faculty voting may not be set up yet
    }
  };

  const detectTiedPositions = () => {
    const tied: Array<{ id: string; title: string }> = [];
    results.forEach(pos => {
      if (pos.candidates.length <= 1) return; // Uncontested
      const sorted = [...pos.candidates].sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
      const topVote = sorted[0].voteCount ?? 0;
      const tiedCandidates = sorted.filter(c => c.voteCount === topVote);
      if (tiedCandidates.length > 1) {
        tied.push({ id: pos.id, title: pos.title });
      }
    });
    return tied;
  };

  const addFacultyVoters = async (electionId: string) => {
    if (!facultyInput.trim()) {
      toast.error("Enter faculty emails (comma or line separated)");
      return;
    }

    const tiedPositions = detectTiedPositions();
    if (tiedPositions.length === 0) {
      toast.error("No tied positions detected");
      return;
    }

    const emails = facultyInput
      .split(/[,\n]/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (emails.length === 0) {
      toast.error("No valid emails");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch(`/api/admin/elections/${electionId}/faculty`, {
        method: "POST",
        headers: hdr(),
        body: JSON.stringify({
          facultyEmails: emails,
          tiedPositionIds: tiedPositions.map(p => p.id),
        }),
      });

      if (!r.ok) throw new Error((await r.json()).error);
      
      toast.success(`${emails.length} faculty voters added`);
      setFacultyInput("");
      setShowFacultyForm(false);
      fetchFacultyStatus(electionId);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) return (
    <div className="min-h-screen bg-[#0d0d10] flex items-center justify-center"><Loader /></div>
  );

  if (!user) return (
    <div className="min-h-screen bg-[#0d0d10] flex items-center justify-center text-white">
      <p className="text-slate-500 font-mono text-sm">Access denied. Admin only.</p>
    </div>
  );

  const activePos = selectedElection?.positions?.find(p => p.id === activePosId);

  return (
    <div className="min-h-screen bg-[#0d0d10] text-white">
      <Toaster position="top-right" toastOptions={{ style: { background: "#1a1a1f", color: "#fff", border: "1px solid #2a2a30" } }} />
      {confirmDialog}

      {/* ── Top Nav ── */}
      <header className="border-b border-slate-800/60 px-6 py-4 flex items-center justify-between sticky top-0 bg-[#0d0d10]/95 backdrop-blur z-50">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <p className="text-white font-black text-sm tracking-tight">Aikya Admin</p>
            <p className="text-slate-600 font-mono text-[10px] uppercase tracking-wider">SMVITM · AIML</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-600 font-mono text-xs hidden sm:block">{user.email}</span>
          <button onClick={() => auth.signOut()} className="text-slate-500 hover:text-white text-xs transition-colors border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-lg">
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Tab Bar ── */}
        <div className="flex gap-1 p-1 bg-slate-900/60 rounded-xl border border-slate-800/50 w-fit">
          {(["elections", "candidates", "results"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all capitalize
                ${tab === t ? "bg-[#fab900] text-[#0d0d10]" : "text-slate-400 hover:text-white"}`}>
              {t}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB: ELECTIONS
        ══════════════════════════════════════════════════════════════════════ */}
        {tab === "elections" && (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-2">
              <Section title={editingElection ? "Edit Election" : "New Election"}>
                <div className="space-y-3">
                  <Field label="Title">
                    <input value={eForm.title} onChange={e => setEForm(f => ({ ...f, title: e.target.value }))}
                      placeholder="Aikya Student Forum Elections 2026"
                      className={inputCls} />
                  </Field>
                  <Field label="Voting Starts">
                    <input type="datetime-local" value={eForm.votingStartsAt}
                      onChange={e => setEForm(f => ({ ...f, votingStartsAt: e.target.value }))}
                      className={inputCls} />
                  </Field>
                  <Field label="Voting Ends">
                    <input type="datetime-local" value={eForm.votingEndsAt}
                      onChange={e => setEForm(f => ({ ...f, votingEndsAt: e.target.value }))}
                      className={inputCls} />
                  </Field>

                  {/* ── Eligible Admission Years ── */}
                  <Field label="Eligible Admission Years">
                    <AdmissionYearPicker
                      selected={eForm.eligibleAdmissionYears}
                      onChange={years => setEForm(f => ({ ...f, eligibleAdmissionYears: years }))}
                    />
                  </Field>

                  <div className="flex gap-2 pt-1">
                    <Btn onClick={saveElection} loading={loading} gold>
                      {editingElection ? "Update Election" : "Create Election"}
                    </Btn>
                    {editingElection && (
                      <Btn onClick={() => {
                        setEditingElection(null);
                        setEForm({ title: "", votingStartsAt: "", votingEndsAt: "", eligibleAdmissionYears: [] });
                      }}>
                        Cancel
                      </Btn>
                    )}
                  </div>
                </div>
              </Section>
            </div>

            <div className="xl:col-span-3 space-y-4">
              <Section title={`Elections (${elections.length})`}>
                {loading && elections.length === 0 ? <Loader /> :
                  elections.length === 0 ? <EmptyState text="No elections yet" /> :
                  elections.map(el => (
                    <ElectionCard key={el.id} el={el}
                      onEdit={() => {
                        setEditingElection(el.id);
                        setEForm({
                          title: el.title,
                          votingStartsAt: toInputVal(el.votingStartsAt),
                          votingEndsAt: toInputVal(el.votingEndsAt),
                          eligibleAdmissionYears: el.eligibleAdmissionYears ?? [],
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      onDelete={() => deleteElection(el.id, el.title)}
                      onManage={() => selectElection(el)}
                      onStart={() => updateStatus(el.id, "start", el.title, el)}
                      onEnd={() => updateStatus(el.id, "end", el.title)}
                      onPublish={() => updateStatus(el.id, "publish", el.title)}
                      onExtend={(s, e) => extendTiming(el.id, s, e, el.title)}
                      onResults={() => fetchResults(el.id)}
                    />
                  ))
                }
              </Section>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB: CANDIDATES
        ══════════════════════════════════════════════════════════════════════ */}
        {tab === "candidates" && (
          !selectedElection ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-2xl">🗳️</div>
              <p className="text-slate-400 text-sm">Select an election from the Elections tab to manage candidates.</p>
              <Btn onClick={() => setTab("elections")} gold>Go to Elections</Btn>
            </div>
          ) : (
            <div className="space-y-5">

              {/* ── Election Context Bar ── */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                <div>
                  <p className="text-white font-bold">{selectedElection.title}</p>
                  <p className="text-slate-500 font-mono text-xs">
                    {fmt(selectedElection.votingStartsAt)} → {fmt(selectedElection.votingEndsAt)}
                  </p>
                  {selectedElection.eligibleAdmissionYears && selectedElection.eligibleAdmissionYears.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-slate-600 font-mono text-[10px] uppercase">Eligible:</span>
                      {selectedElection.eligibleAdmissionYears.map(y => (
                        <span key={y} className="text-[#fab900] font-mono text-[10px] bg-[#fab900]/10 border border-[#fab900]/20 px-1.5 py-0.5 rounded">
                          {y}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-mono uppercase ${STATUS_COLOR[selectedElection.status]}`}>
                    {STATUS_LABEL[selectedElection.status]}
                  </span>
                  {selectedElection.totalVoters !== undefined && (
                    <span className="text-slate-400 font-mono text-xs bg-slate-800 px-3 py-1 rounded-full">
                      {selectedElection.totalVoters} voters
                    </span>
                  )}
                </div>
              </div>

              {/* ── Position Tab Strip ── */}
              <div className="space-y-2">
                <p className="text-slate-500 font-mono text-[10px] uppercase tracking-wider px-1">Select a position to manage</p>
                <div className="flex flex-wrap gap-2">
                  {selectedElection.positions?.map((pos, idx) => {
                    const isActive = activePosId === pos.id;
                    return (
                      <button key={pos.id}
                        onClick={() => { setActivePosId(pos.id); setEditingCandidate(null); setCForm({ name: "", usn: "", bio: "" }); }}
                        className={`relative flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all
                          ${isActive
                            ? "bg-[#fab900] border-[#fab900] text-[#0d0d10] shadow-lg shadow-[#fab900]/20"
                            : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600"
                          }`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0
                          ${isActive ? "bg-[#0d0d10]/20 text-[#0d0d10]" : "bg-slate-800 text-slate-500"}`}>
                          {idx + 1}
                        </span>
                        <span className="truncate max-w-40">{pos.title}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0
                          ${isActive ? "bg-[#0d0d10]/20 text-[#0d0d10]" : "bg-slate-800 text-slate-500"}`}>
                          {pos.candidates.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Active Position Hero Banner ── */}
              {activePos && (
                <div className="relative overflow-hidden rounded-2xl border border-[#fab900]/25 bg-linear-to-r from-amber-950/40 via-[#fab900]/5 to-transparent p-5">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#fab900] rounded-l-2xl" />
                  <div className="pl-3">
                    <span className="text-[#fab900] font-mono text-[10px] uppercase tracking-widest">Currently Managing</span>
                    <p className="text-white text-xl font-black tracking-tight">{activePos.title}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-slate-400 font-mono text-xs">{activePos.yearLabel}</span>
                      <span className="text-slate-700">·</span>
                      <span className="text-slate-400 font-mono text-xs">
                        {activePos.candidates.length} candidate{activePos.candidates.length !== 1 ? "s" : ""} enrolled
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Main Content Grid ── */}
              {activePos ? (
                <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                  {/* Add / Edit Form */}
                  <div className="xl:col-span-2">
                    <div className="rounded-xl border border-slate-800/60 bg-slate-900/20 overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-800/60 bg-slate-900/40 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#fab900]" />
                        <p className="font-bold text-sm text-white tracking-tight">
                          {editingCandidate ? "Edit Candidate" : (
                            <span>Add candidate to <span className="text-[#fab900]">{activePos.title}</span></span>
                          )}
                        </p>
                      </div>
                      <div className="p-5 space-y-3">
                        <Field label="Full Name">
                          <input value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Student name" className={inputCls} />
                        </Field>
                        <Field label="USN">
                          <input value={cForm.usn} onChange={e => setCForm(f => ({ ...f, usn: e.target.value }))}
                            placeholder="4SF22AI001" className={`${inputCls} uppercase`} />
                        </Field>
                        <Field label="Bio (optional)">
                          <textarea value={cForm.bio} onChange={e => setCForm(f => ({ ...f, bio: e.target.value }))}
                            placeholder="Short intro..." rows={2} className={`${inputCls} resize-none`} />
                        </Field>
                        {!editingCandidate && (
                          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#fab900]/8 border border-[#fab900]/20">
                            <svg className="w-3.5 h-3.5 text-[#fab900] shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            <span className="text-[#fab900] text-xs">
                              Will be added to <span className="font-bold">{activePos.title}</span>
                            </span>
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Btn onClick={saveCandidate} loading={loading} gold>
                            {editingCandidate ? "Update Candidate" : "Add Candidate"}
                          </Btn>
                          {editingCandidate && (
                            <Btn onClick={() => { setEditingCandidate(null); setCForm({ name: "", usn: "", bio: "" }); }}>Cancel</Btn>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Candidates List */}
                  <div className="xl:col-span-3">
                    <div className="rounded-xl border border-slate-800/60 bg-slate-900/20 overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-800/60 bg-slate-900/40 flex items-center justify-between">
                        <p className="font-bold text-sm text-white tracking-tight">{activePos.title} — Candidates</p>
                        <span className="text-slate-500 font-mono text-xs bg-slate-800 px-2 py-0.5 rounded-full">
                          {activePos.candidates.length} total
                        </span>
                      </div>
                      <div className="p-5">
                        {activePos.candidates.length === 0 ? (
                          <EmptyState text={`No candidates yet for ${activePos.title}. Add one using the form.`} />
                        ) : (
                          <div className="space-y-3">
                            {activePos.candidates.map((c) => (
                              <div key={c.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/30 hover:border-slate-700 transition-colors group">
                                <div className="w-10 h-10 rounded-full bg-[#fab900]/10 border border-[#fab900]/20 flex items-center justify-center text-sm font-black text-[#fab900] shrink-0">
                                  {c.name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-white truncate">{c.name}</p>
                                  <p className="font-mono text-xs text-slate-500">{c.usn}</p>
                                  {c.bio && <p className="text-xs text-slate-600 mt-0.5 truncate">{c.bio}</p>}
                                </div>
                                {c.voteCount !== undefined && (
                                  <div className="text-center shrink-0">
                                    <p className="text-2xl font-black text-[#fab900]">{c.voteCount}</p>
                                    <p className="text-slate-600 font-mono text-[10px]">votes</p>
                                  </div>
                                )}
                                <div className="flex flex-col gap-1.5 shrink-0">
                                  <button onClick={() => {
                                    setEditingCandidate({ positionId: activePos.id, candidateId: c.id });
                                    setCForm({ name: c.name, usn: c.usn, bio: c.bio ?? "" });
                                  }} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors">
                                    Edit
                                  </button>
                                  <button onClick={() => deleteCandidate(activePos.id, c.id, c.name, activePos.title)}
                                    className="text-xs text-red-500/60 hover:text-red-400 px-3 py-1.5 rounded-lg border border-red-900/30 hover:border-red-800 transition-colors">
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState text="Select a position above to manage its candidates." />
              )}
            </div>
          )
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB: RESULTS
        ══════════════════════════════════════════════════════════════════════ */}
        {tab === "results" && (
          <div className="space-y-6">
            <Section title="View Results">
              <div className="flex flex-wrap gap-3">
                {elections.filter(e => e.status === "closed" || e.status === "results_published").map(el => (
                  <button key={el.id} onClick={() => fetchResults(el.id)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-800 bg-slate-900/40 hover:border-[#fab900]/40 hover:bg-amber-950/20 transition-all text-left">
                    <div>
                      <p className="text-white font-semibold text-sm">{el.title}</p>
                      <p className="text-slate-500 font-mono text-[10px] uppercase">{el.status}</p>
                    </div>
                  </button>
                ))}
                {elections.filter(e => e.status === "closed" || e.status === "results_published").length === 0 && (
                  <p className="text-slate-600 text-sm">No closed elections yet.</p>
                )}
              </div>
            </Section>

            {results.length > 0 && (
              <div className="space-y-4">
                {/* Tie Detection & Faculty Voting */}
                {(() => {
                  const tiedPositions = detectTiedPositions();
                  return tiedPositions.length > 0 ? (
                    <Section title="🔀 Tied Positions Detected">
                      <div className="space-y-4">
                        <div className="bg-amber-950/30 border border-amber-900/40 rounded-lg p-4">
                          <p className="text-amber-100 text-sm font-semibold mb-2">
                            {tiedPositions.length} position{tiedPositions.length !== 1 ? "s" : ""} have tied votes
                          </p>
                          <p className="text-amber-100/70 text-xs mb-3">
                            {tiedPositions.map(p => p.title).join(", ")}
                          </p>
                          
                          {!facultyStatus || facultyStatus.totalVoters === 0 ? (
                            <div className="space-y-3">
                              {!showFacultyForm ? (
                                <Btn onClick={() => setShowFacultyForm(true)} sm gold>
                                  + Add Faculty Voters
                                </Btn>
                              ) : (
                                <div className="space-y-3">
                                  <textarea
                                    value={facultyInput}
                                    onChange={e => setFacultyInput(e.target.value)}
                                    placeholder="Enter faculty emails (comma or line separated)&#10;faculty1@domain.com&#10;faculty2@domain.com"
                                    rows={3}
                                    className={`${inputCls} resize-none`}
                                  />
                                  <div className="flex gap-2">
                                    <Btn
                                      onClick={() => addFacultyVoters(selectedResultElectionId)}
                                      loading={loading}
                                      sm
                                      gold
                                    >
                                      Send Voting Links
                                    </Btn>
                                    <Btn onClick={() => { setShowFacultyForm(false); setFacultyInput(""); }} sm>
                                      Cancel
                                    </Btn>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="grid grid-cols-3 gap-2 text-center">
                                <div>
                                  <p className="text-2xl font-black text-amber-200">{facultyStatus.totalVoters}</p>
                                  <p className="text-xs text-amber-100/60">Total</p>
                                </div>
                                <div>
                                  <p className="text-2xl font-black text-emerald-400">{facultyStatus.votedCount}</p>
                                  <p className="text-xs text-amber-100/60">Voted</p>
                                </div>
                                <div>
                                  <p className="text-2xl font-black text-orange-400">{facultyStatus.pendingCount}</p>
                                  <p className="text-xs text-amber-100/60">Pending</p>
                                </div>
                              </div>
                              <p className="text-xs text-amber-100/70 text-center mt-2">
                                {facultyStatus.votedCount === facultyStatus.totalVoters
                                  ? "✓ All faculty have voted"
                                  : `Waiting for ${facultyStatus.pendingCount} faculty voter${facultyStatus.pendingCount !== 1 ? "s" : ""}`}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </Section>
                  ) : null;
                })()}

                {/* Results Display */}
                {results.map(pos => {
                  const total = pos.candidates.reduce((s, c) => s + (c.voteCount ?? 0), 0);
                  const sorted = [...pos.candidates].sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0));
                  const topVote = sorted[0]?.voteCount ?? 0;
                  const tiedWinners = sorted.filter(c => c.voteCount === topVote);
                  const isTied = tiedWinners.length > 1;

                  return (
                    <Section key={pos.id} title={isTied ? `${pos.title} 🔀 TIED` : pos.title}>
                      <div className="space-y-3">
                        {sorted.map((c, i) => {
                          const pct = total ? Math.round(((c.voteCount ?? 0) / total) * 100) : 0;
                          const isWinner = tiedWinners.some(w => w.id === c.id);
                          return (
                            <div key={c.id} className={`p-4 rounded-xl border transition-colors ${isWinner ? "border-[#fab900]/40 bg-[#fab900]/5" : "border-slate-800 bg-slate-900/30"}`}>
                              <div className="flex items-center gap-4 mb-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black shrink-0
                                  ${isWinner ? "bg-[#fab900]/20 text-[#fab900]" : "bg-slate-800 text-slate-400"}`}>
                                  {isWinner && isTied ? "⚖️" : isWinner ? "👑" : i + 1}
                                </div>
                                <div className="flex-1">
                                  <p className={`font-bold text-sm ${isWinner ? "text-white" : "text-slate-300"}`}>{c.name}</p>
                                  <p className="font-mono text-xs text-slate-600">{c.usn}</p>
                                </div>
                                <div className="text-right">
                                  <p className={`font-black text-xl ${isWinner ? "text-[#fab900]" : "text-slate-300"}`}>{c.voteCount ?? 0}</p>
                                  <p className="text-slate-600 font-mono text-xs">{pct}%</p>
                                </div>
                              </div>
                              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-1000 ${isWinner ? "bg-[#fab900]" : "bg-slate-600"}`}
                                  style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        <p className="text-slate-600 font-mono text-xs text-right">{total} total votes</p>
                      </div>
                    </Section>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Election Card ─────────────────────────────────────────────────────────────
function ElectionCard({ el, onEdit, onDelete, onManage, onStart, onEnd, onPublish, onExtend, onResults }: {
  el: Election;
  onEdit: () => void; onDelete: () => void; onManage: () => void;
  onStart: () => void; onEnd: () => void; onPublish: () => void;
  onExtend: (s: string, e: string) => void; onResults: () => void;
}) {
  const [showExtend, setShowExtend] = useState(false);
  const [extStart, setExtStart] = useState(toInputVal(el.votingStartsAt));
  const [extEnd, setExtEnd]     = useState(toInputVal(el.votingEndsAt));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5 space-y-4 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white truncate">{el.title}</p>
          <p className="text-slate-500 font-mono text-xs mt-0.5">
            {fmt(el.votingStartsAt)} → {fmt(el.votingEndsAt)}
          </p>
          {/* Eligible admission years badge row */}
          {el.eligibleAdmissionYears && el.eligibleAdmissionYears.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-slate-600 font-mono text-[10px]">Eligible batches:</span>
              {el.eligibleAdmissionYears.map(y => (
                <span key={y} className="text-[#fab900]/80 font-mono text-[10px] bg-[#fab900]/8 border border-[#fab900]/15 px-1.5 py-0.5 rounded">
                  {y}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase ${STATUS_COLOR[el.status]}`}>
          {el.status}
        </span>
      </div>

      {el.totalVoters !== undefined && (
        <p className="text-slate-500 font-mono text-xs">
          <span className="text-white font-bold">{el.totalVoters}</span> votes cast
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Btn onClick={onManage} sm>Manage Candidates</Btn>
        {el.status === "draft"  && <Btn onClick={onStart} sm gold>▶ Start Voting</Btn>}
        {el.status === "active" && <Btn onClick={onEnd}   sm className="border-red-900/40 text-red-400 hover:border-red-700">⏹ End Voting</Btn>}
        {el.status === "closed" && <Btn onClick={onPublish} sm gold>🏆 Publish Results</Btn>}
        {(el.status === "closed" || el.status === "results_published") && <Btn onClick={onResults} sm>View Results</Btn>}
        <Btn onClick={() => setShowExtend(v => !v)} sm>⏱ Adjust Timing</Btn>
        {el.status === "draft" && <Btn onClick={onEdit} sm>Edit</Btn>}
        {el.status === "draft" && (
          <Btn onClick={onDelete} sm className="border-red-900/30 text-red-500/60 hover:text-red-400 hover:border-red-800">Delete</Btn>
        )}
      </div>

      {showExtend && (
        <div className="border-t border-slate-800 pt-4 grid grid-cols-2 gap-3">
          <Field label="New Start">
            <input type="datetime-local" value={extStart} onChange={e => setExtStart(e.target.value)} className={inputCls} />
          </Field>
          <Field label="New End">
            <input type="datetime-local" value={extEnd} onChange={e => setExtEnd(e.target.value)} className={inputCls} />
          </Field>
          <div className="col-span-2 flex gap-2">
            <Btn onClick={() => onExtend(extStart, extEnd)} sm gold>Apply</Btn>
            <Btn onClick={() => setShowExtend(false)} sm>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tiny UI Helpers ──────────────────────────────────────────────────────────
const inputCls = "w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#fab900]/50 transition-colors";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/20 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800/60 bg-slate-900/40">
        <p className="font-bold text-sm text-white tracking-tight">{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-slate-500 font-mono text-[10px] uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function Btn({ onClick, children, loading, gold, sm, className = "" }: {
  onClick: () => void; children: React.ReactNode;
  loading?: boolean; gold?: boolean; sm?: boolean; className?: string;
}) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`flex items-center gap-1.5 font-semibold rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed
        ${sm ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"}
        ${gold ? "bg-[#fab900] border-[#fab900] text-[#0d0d10] hover:bg-[#ffd040]"
               : `bg-transparent border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white ${className}`}`}>
      {loading && <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-slate-600 text-sm text-center py-6">{text}</p>;
}

function Loader() {
  return (
    <div className="flex gap-2 items-center justify-center py-8">
      {[0,1,2].map(i => (
        <div key={i} className="w-2 h-2 rounded-full bg-[#fab900]"
          style={{ animation: `bounce 1s ease-in-out ${i*0.15}s infinite` }} />
      ))}
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
      <polygon points="20,4 36,32 4,32" fill="none" stroke="#fab900" strokeWidth="2.5" strokeLinejoin="round"/>
      <circle cx="20" cy="22" r="4" fill="#fab900" />
    </svg>
  );
}
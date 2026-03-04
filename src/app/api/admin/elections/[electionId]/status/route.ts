// ════════════════════════════════════════════════════════════════════════════
// FILE: app/api/admin/elections/[electionId]/status/route.ts
// ════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

export async function POST(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;
    const { action } = await req.json();

    const elRef  = db.collection("elections").doc(electionId);
    const elSnap = await elRef.get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Election not found" }, { status: 404 });

    const current = elSnap.data()!.status;
    const TRANSITIONS: Record<string, { from: string; to: string }> = {
      start:   { from: "draft",  to: "active"            },
      end:     { from: "active", to: "closed"            },
      publish: { from: "closed", to: "results_published" },
    };

    const t = TRANSITIONS[action];
    if (!t) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    if (current !== t.from)
      return NextResponse.json({ error: `Cannot ${action} — current status is "${current}"` }, { status: 400 });

    const update: Record<string, unknown> = {
      status: t.to,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (action === "start")   update.actualStartedAt = admin.firestore.FieldValue.serverTimestamp();
    if (action === "end")     update.actualEndedAt   = admin.firestore.FieldValue.serverTimestamp();
    if (action === "publish") update.resultsPublished = true;

    await elRef.update(update);
    return NextResponse.json({ success: true, newStatus: t.to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}


// ════════════════════════════════════════════════════════════════════════════
// FILE: app/api/admin/elections/[electionId]/results/route.ts
// GET — full results with vote counts per candidate (admin + public share)
// ════════════════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    const params = await context.params;
    // Public endpoint — just verify the election is published
    const elRef  = db.collection("elections").doc(params.electionId);
    const elSnap = await elRef.get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data   = elSnap.data()!;
    const status = data.status;

    // Admin can see results when closed; public only after published
    const authHeader = req.headers.get("authorization");
    let isAdmin = false;
    if (authHeader) {
      try {
        const token   = authHeader.split("Bearer ")[1];
        const decoded = await admin.auth().verifyIdToken(token);
        const snap    = await db.collection("users").doc(decoded.uid).get();
        isAdmin = snap.data()?.role === "admin";
      } catch {}
    }

    if (!isAdmin && status !== "results_published") {
      return NextResponse.json({ error: "Results not yet published" }, { status: 403 });
    }
    if (isAdmin && status !== "closed" && status !== "results_published") {
      return NextResponse.json({ error: "Election must be closed first" }, { status: 403 });
    }

    const posSnap = await elRef.collection("positions").orderBy("order").get();

    const positions = await Promise.all(
      posSnap.docs.map(async (posDoc) => {
        const candSnap = await posDoc.ref.collection("candidates").get();
        const candidates = candSnap.docs
          .map((c) => ({
            id: c.id,
            name:      c.data().name,
            usn:       c.data().usn,
            bio:       c.data().bio ?? "",
            voteCount: c.data().voteCount ?? 0,
          }))
          .sort((a, b) => b.voteCount - a.voteCount);

        return {
          id:         posDoc.id,
          title:      posDoc.data().title,
          yearLabel:  posDoc.data().yearLabel,
          order:      posDoc.data().order,
          candidates,
          totalVotes: candidates.reduce((s, c) => s + c.voteCount, 0),
        };
      })
    );

    return NextResponse.json({
      electionTitle: data.title,
      status,
      resultsPublished: data.resultsPublished ?? false,
      positions,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}




import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

// ─── PATCH /api/admin/elections/[electionId]/timing ──────────────────────────
// Adjust start/end time on any non-published election
export async function PATCH(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;
    const { votingStartsAt, votingEndsAt } = await req.json();

    if (!votingStartsAt || !votingEndsAt)
      return NextResponse.json({ error: "Both start and end are required" }, { status: 400 });
    if (new Date(votingStartsAt) >= new Date(votingEndsAt))
      return NextResponse.json({ error: "Start must be before end" }, { status: 400 });

    const elRef  = db.collection("elections").doc(electionId);
    const elSnap = await elRef.get();
    if (!elSnap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (elSnap.data()!.status === "results_published")
      return NextResponse.json({ error: "Cannot change timing of published results" }, { status: 400 });

    await elRef.update({
      votingStartsAt: admin.firestore.Timestamp.fromDate(new Date(votingStartsAt)),
      votingEndsAt:   admin.firestore.Timestamp.fromDate(new Date(votingEndsAt)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

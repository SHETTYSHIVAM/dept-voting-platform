import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

function candRef(electionId: string, positionId: string, candidateId: string) {
  return db
    .collection("elections").doc(electionId)
    .collection("positions").doc(positionId)
    .collection("candidates").doc(candidateId);
}

// GET a single candidate
export async function GET(req: NextRequest, context: { params: Promise<{ electionId: string; positionId: string; candidateId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId, positionId, candidateId } = await context.params;
    const snap = await candRef(electionId, positionId, candidateId).get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ candidate: { id: snap.id, ...snap.data() } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// PUT update candidate
export async function PUT(req: NextRequest,  context: { params: Promise<{ electionId: string; positionId: string; candidateId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId, positionId, candidateId } = await context.params;
    const { name, usn, bio = "" } = await req.json();

    if (!name || !usn) {
      return NextResponse.json({ error: "name and usn are required" }, { status: 400 });
    }

    const elSnap = await db.collection("elections").doc(electionId).get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Election not found" }, { status: 404 });
    if (elSnap.data()!.status === "results_published")
      return NextResponse.json({ error: "Cannot modify published election" }, { status: 400 });

    const ref = candRef(electionId, positionId, candidateId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    await ref.update({
      name: name.trim(),
      usn: usn.toUpperCase().trim(),
      bio: bio.trim(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// DELETE a single candidate
export async function DELETE(req: NextRequest, context: { params: Promise<{ electionId: string; positionId: string; candidateId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId, positionId, candidateId } = await context.params;

    const elSnap = await db.collection("elections").doc(electionId).get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Election not found" }, { status: 404 });
    if (elSnap.data()!.status === "results_published")
      return NextResponse.json({ error: "Cannot modify published election" }, { status: 400 });

    const ref = candRef(electionId, positionId, candidateId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

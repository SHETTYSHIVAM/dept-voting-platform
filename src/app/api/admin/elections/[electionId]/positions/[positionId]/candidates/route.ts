import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

// GET /api/admin/elections/[electionId]/positions/[positionId]/candidates
export async function GET(req: NextRequest, context: { params: Promise<{ electionId: string; positionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId, positionId } = await context.params;

    const snap = await db
      .collection("elections").doc(electionId)
      .collection("positions").doc(positionId)
      .collection("candidates")
      .orderBy("createdAt")
      .get();

    const candidates = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: undefined }));
    return NextResponse.json({ candidates });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// POST create candidate
export async function POST(req: NextRequest, context: { params: Promise<{ electionId: string; positionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId, positionId } = await context.params;
    const { name, usn, bio = "" } = await req.json();

    if (!name || !usn) {
      return NextResponse.json({ error: "name and usn are required" }, { status: 400 });
    }

    // Check election isn't published or soft-deleted
    const elSnap = await db.collection("elections").doc(electionId).get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Election not found" }, { status: 404 });
    if (elSnap.data()!.status === "results_published")
      return NextResponse.json({ error: "Cannot modify published election" }, { status: 400 });

    // Check position exists
    const posSnap = await db
      .collection("elections").doc(electionId)
      .collection("positions").doc(positionId).get();
    if (!posSnap.exists) return NextResponse.json({ error: "Position not found" }, { status: 404 });

    const candRef = db
      .collection("elections").doc(electionId)
      .collection("positions").doc(positionId)
      .collection("candidates").doc();

    await candRef.set({
      name: name.trim(),
      usn: usn.toUpperCase().trim(),
      bio: bio.trim(),
      voteCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, candidateId: candRef.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

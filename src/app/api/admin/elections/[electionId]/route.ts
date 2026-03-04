// app/api/admin/elections/[electionId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

// ─── GET /api/admin/elections/[electionId] ────────────────────────────────────
// Full election with all positions and their candidates + vote counts
export async function GET(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;

    const elSnap = await db.collection("elections").doc(electionId).get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const elData = elSnap.data()!;

    // Fetch positions ordered by order field
    const posSnap = await db
      .collection("elections").doc(electionId)
      .collection("positions")
      .orderBy("order")
      .get();


    const positions = await Promise.all(
      posSnap.docs.map(async (posDoc) => {
        const candSnap = await db
          .collection("elections").doc(electionId)
          .collection("positions").doc(posDoc.id)
          .collection("candidates")
          .orderBy("createdAt")
          .get();


        const candidates = candSnap.docs.map((c) => ({
          id: c.id,
          ...c.data(),
          createdAt: undefined, // strip internal fields
        }));

        return {
          id: posDoc.id,
          ...posDoc.data(),
          candidates,
          createdAt: undefined,
        };
      })
    );

    // Voter count
    const votersSnap = await db
      .collection("users")
      .where(`hasVoted.${electionId}`, "==", true)
      .count()
      .get();

    return NextResponse.json({
      election: {
        id: electionId,
        title: elData.title,
        status: elData.status,
        votingStartsAt: elData.votingStartsAt?.toDate().toISOString() ?? null,
        votingEndsAt: elData.votingEndsAt?.toDate().toISOString() ?? null,
        resultsPublished: elData.resultsPublished ?? false,
        totalVoters: votersSnap.data().count,
        positions,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── PUT /api/admin/elections/[electionId] ────────────────────────────────────
// Update title / timing (only allowed if draft)
export async function PUT(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;
    const { title, votingStartsAt, votingEndsAt } = await req.json();

    const elRef = db.collection("elections").doc(electionId);
    const elSnap = await elRef.get();
    if (!elSnap.exists || elSnap.data()!.isDeleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (elSnap.data()!.status !== "draft") {
      return NextResponse.json({ error: "Can only edit draft elections" }, { status: 400 });
    }
    if (new Date(votingStartsAt) >= new Date(votingEndsAt)) {
      return NextResponse.json({ error: "Start must be before end" }, { status: 400 });
    }

    await elRef.update({
      title,
      votingStartsAt: admin.firestore.Timestamp.fromDate(new Date(votingStartsAt)),
      votingEndsAt: admin.firestore.Timestamp.fromDate(new Date(votingEndsAt)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── DELETE /api/admin/elections/[electionId] ─────────────────────────────────
// Only allowed for draft elections
// DELETE → Soft delete
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ electionId: string }> }
) {
  try {
    const adminUser = await requireAdmin(req);
    const { electionId } = await context.params;

    const elRef = db.collection("elections").doc(electionId);
    const elSnap = await elRef.get();

    if (!elSnap.exists)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (elSnap.data()!.isDeleted)
      return NextResponse.json({ error: "Already deleted" }, { status: 400 });

    await elRef.update({
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: adminUser.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";
import crypto from "crypto";

// ─── POST: Add faculty voters for tied positions ──────────────────────────────
export async function POST(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;
    const { facultyEmails, tiedPositionIds } = await req.json();

    if (!Array.isArray(facultyEmails) || facultyEmails.length === 0) {
      return NextResponse.json({ error: "Faculty emails array required" }, { status: 400 });
    }
    if (!Array.isArray(tiedPositionIds) || tiedPositionIds.length === 0) {
      return NextResponse.json({ error: "Tied position IDs required" }, { status: 400 });
    }

    const elRef = db.collection("elections").doc(electionId);
    const elSnap = await elRef.get();
    if (!elSnap.exists) return NextResponse.json({ error: "Election not found" }, { status: 404 });

    const election = elSnap.data()!;
    if (election.status === "draft") {
      return NextResponse.json({ error: "Cannot add faculty voters to draft election" }, { status: 400 });
    }

    const batch = db.batch();
    const facultyCollRef = elRef.collection("facultyVoting");

    // Check if faculty voters already exist
    const existingSnap = await facultyCollRef.get();
    if (existingSnap.size > 0) {
      return NextResponse.json({ error: "Faculty voters already added. Use PUT to update." }, { status: 400 });
    }

    // Add faculty voters
    for (const email of facultyEmails) {
      const validEmail = email.trim().toLowerCase();
      if (!validEmail.includes("@")) {
        return NextResponse.json({ error: `Invalid email: ${email}` }, { status: 400 });
      }

      const votingToken = crypto.randomBytes(32).toString("hex");
      const facultyDocRef = facultyCollRef.doc(validEmail);

      batch.set(facultyDocRef, {
        email: validEmail,
        tiedPositionIds,
        votingToken,
        hasVoted: false,
        votes: {},
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        votedAt: null,
      });
    }

    // Update election to mark faculty voting as active
    batch.update(elRef, {
      hasFacultyVoting: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      message: `${facultyEmails.length} faculty voters added`,
      count: facultyEmails.length,
    }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── GET: Get faculty voting status ───────────────────────────────────────────
export async function GET(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;

    const elRef = db.collection("elections").doc(electionId);
    const facultyCollRef = elRef.collection("facultyVoting");

    const facultySnap = await facultyCollRef.get();
    const faculty = facultySnap.docs.map(doc => {
      const data = doc.data();
      return {
        email: data.email,
        hasVoted: data.hasVoted,
        votes: data.hasVoted ? Object.keys(data.votes).length : 0,
        votedAt: data.votedAt?.toDate().toISOString() ?? null,
      };
    });

    const totalVoters = faculty.length;
    const votedCount = faculty.filter(f => f.hasVoted).length;
    const pendingCount = totalVoters - votedCount;

    return NextResponse.json({
      totalVoters,
      votedCount,
      pendingCount,
      faculty,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── PUT: Update faculty voters (Replace) ─────────────────────────────────────
export async function PUT(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;
    const { facultyEmails, tiedPositionIds } = await req.json();

    if (!Array.isArray(facultyEmails) || facultyEmails.length === 0) {
      return NextResponse.json({ error: "Faculty emails array required" }, { status: 400 });
    }
    if (!Array.isArray(tiedPositionIds) || tiedPositionIds.length === 0) {
      return NextResponse.json({ error: "Tied position IDs required" }, { status: 400 });
    }

    const elRef = db.collection("elections").doc(electionId);
    const facultyCollRef = elRef.collection("facultyVoting");

    const batch = db.batch();

    // Delete existing faculty voters who haven't voted
    const existingSnap = await facultyCollRef.where("hasVoted", "==", false).get();
    existingSnap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Add new faculty voters
    for (const email of facultyEmails) {
      const validEmail = email.trim().toLowerCase();
      if (!validEmail.includes("@")) {
        return NextResponse.json({ error: `Invalid email: ${email}` }, { status: 400 });
      }

      const facultyDocRef = facultyCollRef.doc(validEmail);
      const existingDoc = await facultyDocRef.get();

      // Only add if doesn't already exist
      if (!existingDoc.exists) {
        const votingToken = crypto.randomBytes(32).toString("hex");
        batch.set(facultyDocRef, {
          email: validEmail,
          tiedPositionIds,
          votingToken,
          hasVoted: false,
          votes: {},
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          votedAt: null,
        });
      }
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      message: "Faculty voters updated",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── DELETE: Remove faculty voter ─────────────────────────────────────────────
export async function DELETE(req: NextRequest, context: { params: Promise<{ electionId: string }> }) {
  try {
    await requireAdmin(req);
    const { electionId } = await context.params;
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const elRef = db.collection("elections").doc(electionId);
    const facultyDocRef = elRef.collection("facultyVoting").doc(email.trim().toLowerCase());

    const facultySnap = await facultyDocRef.get();
    if (!facultySnap.exists) {
      return NextResponse.json({ error: "Faculty voter not found" }, { status: 404 });
    }

    if (facultySnap.data()!.hasVoted) {
      return NextResponse.json({ error: "Cannot remove faculty voter who has already voted" }, { status: 400 });
    }

    await facultyDocRef.delete();

    return NextResponse.json({ success: true, message: "Faculty voter removed" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

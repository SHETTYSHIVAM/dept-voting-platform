import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.split("Bearer ")[1];
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await admin.auth().verifyIdToken(token);

    const { searchParams } = new URL(req.url);
    const electionId = searchParams.get("electionId");
    if (!electionId) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    // Verify election exists and is not soft-deleted
    const electionDoc = await db.collection("elections").doc(electionId).get();
    if (!electionDoc.exists || electionDoc.data()!.isDeleted) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    // 1. Fetch all positions
    const positionsSnap = await db
      .collection("elections")
      .doc(electionId)
      .collection("positions")
      .get();

    if (positionsSnap.empty) {
      return NextResponse.json({ roles: [] });
    }

    // 2. For each position, fetch its candidates subcollection in parallel
const roles = (await Promise.all(
  positionsSnap.docs.map(async (posDoc) => {
    const posData = posDoc.data();

    const candidatesSnap = await db
      .collection("elections")
      .doc(electionId)
      .collection("positions")
      .doc(posDoc.id)
      .collection("candidates")
      .get();

    const candidates = candidatesSnap.docs.map((cDoc) => {
      const c = cDoc.data();
      return {
        id: cDoc.id,
        name: c.name,
        usn: c.usn ?? null,
      };
    });

    return {
      id: posDoc.id,
      title: posData.title,
      yearLabel: posData.yearLabel ?? null,
      candidates,
    };
  })
)).filter((role) => role.candidates.length > 1);

    return NextResponse.json({ roles });
  } catch (error: any) {
    console.error("Ballot Fetch Error:", error);
    return NextResponse.json({ error: error.message || "Failed to load ballot" }, { status: 500 });
  }
}
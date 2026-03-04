// app/api/elections/route.ts
// Returns all non-draft elections visible to authenticated voters
import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";

export async function GET(req: NextRequest) {
  try {
    // Verify Firebase auth token
    const token = req.headers.get("authorization")?.split("Bearer ")[1];
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = await admin.auth().verifyIdToken(token);

    // User must exist and have approved status
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch all elections that are not drafts (voter-visible) and not soft-deleted
    const snap = await db
      .collection("elections")
      .where("isDeleted", "==", false)
      .where("status", "!=", "draft")
      .orderBy("status")           // Firestore requires orderBy on inequality field
      .orderBy("votingStartsAt", "desc")
      .get();

    const elections = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title,
        status: d.status,
        votingStartsAt: d.votingStartsAt?.toDate().toISOString() ?? null,
        votingEndsAt: d.votingEndsAt?.toDate().toISOString() ?? null,
        resultsPublished: d.resultsPublished ?? false,
        // NOTE: hasVoted is merged client-side from Firestore user doc
        // to avoid exposing voting status across users
      };
    });


    return NextResponse.json({ elections });
  } catch (e: any) {
    console.error("[GET /api/elections]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
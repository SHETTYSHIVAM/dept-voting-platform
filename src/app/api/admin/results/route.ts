import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/firebase-admin";
import { verifyAdmin } from "@/lib/firebase/firebase-admin";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const idToken = authHeader?.split("Bearer ")[1];

  if (!idToken || !(await verifyAdmin(idToken))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    // Fetch all candidates and their counts
    const snapshot = await db.collection("candidates").get();
    const results = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch results" }, { status: 500 });
  }
}
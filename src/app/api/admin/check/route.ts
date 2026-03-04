import { NextRequest, NextResponse } from "next/server";
import { admin, db } from "@/lib/firebase/firebase-admin";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.split("Bearer ")[1];
    if (!token) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const role = userDoc.data()?.role;

    return NextResponse.json({
      isAdmin: role === "admin",
    });
  } catch {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }
}
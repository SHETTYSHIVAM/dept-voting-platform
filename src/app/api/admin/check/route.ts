import { NextRequest, NextResponse } from "next/server";
import { admin, db } from "@/lib/firebase/firebase-admin";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.split("Bearer ")[1];

    if (!token) {
      return NextResponse.json({ isAdmin: false }, { status: 401 });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

    // Get role from Firestore
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const role = userDoc.data()?.role;

    const isAdmin =
      decoded.email === ADMIN_EMAIL &&
      role === "admin";

    return NextResponse.json({
      isAdmin,
      role: role ?? "user",
    });

  } catch (error) {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }
}
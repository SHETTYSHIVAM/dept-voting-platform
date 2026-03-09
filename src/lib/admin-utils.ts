import { NextRequest } from "next/server";
import { db, admin } from "./firebase/firebase-admin";

export async function requireAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.split("Bearer ")[1];
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await admin.auth().verifyIdToken(token);
  const snap = await db.collection("users").doc(decoded.uid).get();
  console.log(snap.data());
  if (!snap.exists || snap.data()?.role !== "admin") {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return decoded;
}

export async function isAdmin(token: string) {
  try {
    const decoded = await admin.auth().verifyIdToken(token);

    const userDoc = await db.collection("users").doc(decoded.uid).get();

    if (!userDoc.exists) return false;

    return userDoc.data()?.role === "admin";
  } catch (err) {
    return false;
  }
}
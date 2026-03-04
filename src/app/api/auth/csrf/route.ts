import { NextResponse } from "next/server";
import { generateCSRFToken } from "@/lib/csrf";

export async function GET() {
  const token = generateCSRFToken();

  const res = NextResponse.json({ csrfToken: token });

  res.cookies.set("csrfToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });

  return res;
}
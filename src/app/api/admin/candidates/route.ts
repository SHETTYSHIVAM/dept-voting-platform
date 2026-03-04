import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

// 1. GET: Fetch all candidates
export async function GET(req: NextRequest) {
    await requireAdmin(req);

    try {
        const snapshot = await db.collection('candidates').get();
        const candidates = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
        return NextResponse.json({ candidates }, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

// 2. POST: Create a new candidate
export async function POST(req: NextRequest) {
    await requireAdmin(req);

    try {
        const body = await req.json();
        
        // Match these fields to your election logic
        const { name, postKey, electionId, department, year } = body;

        if (!name || !postKey || !electionId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const docRef = await db.collection('candidates').add({
            name,
            postKey,
            electionId,
            department: department || "AI-ML",
            year: year || 1,
            voteCount: 0,
            photoUrl: ""
        });

        return NextResponse.json({ id: docRef.id, success: true }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 });
    }
}

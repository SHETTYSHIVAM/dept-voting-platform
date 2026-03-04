import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    await requireAdmin(req);
    try {
        const { id } = await context.params;
        const snap = await db.collection('candidates').doc(id).get();
        if (!snap.exists) {
            return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
        }
        return NextResponse.json({ candidate: { id: snap.id, ...snap.data() } }, { status: 200 });
    }
    catch (error) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    await requireAdmin(req);
    try {
        const { id } = await context.params;
        await db.collection('candidates').doc(id).delete();
        return NextResponse.json({ success: true }, { status: 200 });
    }
    catch (error) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    await requireAdmin(req);
    try {
        const { id } = await context.params;
        const body = await req.json();
        const { name, postKey, electionId, department, year } = body;
        if (!name || !postKey || !electionId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        await db.collection('candidates').doc(id).update({
            name,
            postKey,
            electionId,
            department: department || "AI-ML",
            year: year || 1,
        });
        return NextResponse.json({ success: true }, { status: 200 });
    }
    catch (error) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";

// ─── POST: Faculty votes on tied positions ────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { electionId, votingToken, votes } = await req.json();

    if (!electionId || !votingToken || !votes) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const elRef = db.collection("elections").doc(electionId);
    const facultyCollRef = elRef.collection("facultyVoting");

    // Find the faculty document ref first (outside transaction, read-only lookup)
    const facultySnap = await facultyCollRef
      .where("votingToken", "==", votingToken)
      .limit(1)
      .get();

    if (facultySnap.empty) {
      return NextResponse.json({ error: "Invalid voting token" }, { status: 403 });
    }

    const facultyDocRef = facultySnap.docs[0].ref;

    // ── All critical reads + writes happen atomically inside the transaction ──
    await db.runTransaction(async (transaction) => {
      // Re-read the faculty doc inside the transaction to get a consistent snapshot
      const facultyDoc = await transaction.get(facultyDocRef);
      const facultyData = facultyDoc.data()!;

      // ✅ hasVoted check is now inside the transaction — safe from race conditions
      if (facultyData.hasVoted) {
        const err: any = new Error("You have already voted");
        err.status = 400;
        throw err;
      }

      // Validate votes against allowed (tied) positions
      const submittedPositions = Object.keys(votes);
      const allowedPositions: string[] = facultyData.tiedPositionIds;

      for (const posId of submittedPositions) {
        if (!allowedPositions.includes(posId)) {
          const err: any = new Error(`Not authorized to vote on position ${posId}`);
          err.status = 403;
          throw err;
        }
      }

      if (submittedPositions.length !== allowedPositions.length) {
        const err: any = new Error("Must vote for all tied positions");
        err.status = 400;
        throw err;
      }

      // Pre-fetch all candidate docs inside the transaction before writing
      const candidateRefs = (Object.entries(votes) as [string, string][]).map(
        ([positionId, candidateId]) =>
          elRef
            .collection("positions")
            .doc(positionId)
            .collection("candidates")
            .doc(candidateId)
      );

      const candidateSnaps = await Promise.all(
        candidateRefs.map((ref) => transaction.get(ref))
      );

      // Validate all candidates exist before any writes
      for (const snap of candidateSnaps) {
        if (!snap.exists) {
          const err: any = new Error(`Candidate not found: ${snap.id}`);
          err.status = 404;
          throw err;
        }
      }

      // ── Writes (must come after all reads in a Firestore transaction) ──

      // Mark faculty as voted
      transaction.update(facultyDocRef, {
        hasVoted: true,
        votes,
        votedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Increment vote counts atomically using FieldValue.increment
      // ✅ Avoids stale read → write race on voteCount itself
      for (const ref of candidateRefs) {
        transaction.update(ref, {
          voteCount: admin.firestore.FieldValue.increment(1),
        });
      }
    });

    return NextResponse.json({ success: true, message: "Faculty vote recorded" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── GET: Get faculty voting status (public with token) ────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const votingToken = searchParams.get("token");
    const electionId = searchParams.get("electionId");

    if (!votingToken || !electionId) {
      return NextResponse.json({ error: "Token and election ID required" }, { status: 400 });
    }

    const facultySnap = await db
      .collection("elections")
      .doc(electionId)
      .collection("facultyVoting")
      .where("votingToken", "==", votingToken)
      .limit(1)
      .get();

    if (facultySnap.empty) {
      return NextResponse.json({ error: "Invalid token" }, { status: 403 });
    }

    const faculty = facultySnap.docs[0].data();

    if (faculty.hasVoted) {
      return NextResponse.json({ error: "You have already voted" }, { status: 400 });
    }

    // Fetch tied positions data
    const elRef = db.collection("elections").doc(electionId);
    const positionsData = await Promise.all(
      faculty.tiedPositionIds.map(async (posId: string) => {
        const posSnap = await elRef.collection("positions").doc(posId).get();
        const candSnap = await elRef
          .collection("positions")
          .doc(posId)
          .collection("candidates")
          .get();

        const candidates = candSnap.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name,
          usn: doc.data().usn,
          voteCount: doc.data().voteCount ?? 0,
        }));

        return {
          id: posId,
          title: posSnap.data()?.title ?? "Unknown",
          candidates: candidates.sort((a, b) => b.voteCount - a.voteCount),
        };
      })
    );

    return NextResponse.json({
      electionId,
      email: faculty.email,
      positions: positionsData,
      hasVoted: faculty.hasVoted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
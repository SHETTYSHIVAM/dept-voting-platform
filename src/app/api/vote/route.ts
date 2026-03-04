import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { verifyCSRFToken } from "@/lib/csrf";

const ERROR_MAP: Record<string, [string, number]> = {
  ALREADY_VOTED:             ["You have already voted.",        400],
  ELECTION_NOT_FOUND:        ["Election not found.",            404],
  ELECTION_NOT_ACTIVE:       ["Voting is not currently open.",  403],
  VOTING_NOT_STARTED:        ["Voting has not started yet.",    403],
  VOTING_ENDED:              ["Voting period has ended.",       403],
  INVALID_CANDIDATE:         ["Invalid candidate selection.",   400],
  INVALID_POSITION:          ["Invalid position in ballot.",    400],
  INCOMPLETE_BALLOT:         ["Please vote for all positions.", 400],
  USER_NOT_FOUND:            ["User account not found.",        404],
  EMPTY_VOTE:                ["No votes submitted.",            400],
  MISSING_ADMISSION_YEAR:    ["Admission year missing.",        400],
  NOT_ELIGIBLE_VOTER:        ["You are not eligible to vote.",  403],
};

export async function POST(req: NextRequest) {
  try {
    // ── 1. CSRF ──────────────────────────────────────────────────────────────
    const csrfHeader = req.headers.get("x-csrf-token");
    const csrfCookie = req.cookies.get("csrfToken")?.value;
    if (!verifyCSRFToken(csrfCookie, csrfHeader ?? undefined)) {
      return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
    }

    // ── 2. Auth ──────────────────────────────────────────────────────────────
    const idToken = req.headers.get("authorization")?.split("Bearer ")[1];
    if (!idToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // ── 3. Parse body ────────────────────────────────────────────────────────
    // votes shape: Record<positionId, candidateId>
    const { electionId, votes } = await req.json();
    const voteEntries = Object.entries(votes ?? {}) as [string, string][];
    if (!electionId || voteEntries.length === 0) throw new Error("EMPTY_VOTE");

    // ── 4. Transaction ───────────────────────────────────────────────────────
    await db.runTransaction(async (transaction) => {

      const voteLockRef = db.collection("voteLocks").doc(`${uid}_${electionId}`);
      const electionRef = db.collection("elections").doc(electionId);
      const userRef     = db.collection("users").doc(uid);

      // Fetch contested positions outside transaction reads (no writes, safe pre-check)
      const positionsSnap = await db
        .collection("elections").doc(electionId)
        .collection("positions").get();

      const candidateCounts = await Promise.all(
        positionsSnap.docs.map(async (posDoc) => {
          const candidatesSnap = await db
            .collection("elections").doc(electionId)
            .collection("positions").doc(posDoc.id)
            .collection("candidates").get();
          return { id: posDoc.id, count: candidatesSnap.size };
        })
      );

      const contestedPositionIds = new Set(
        candidateCounts.filter((p) => p.count > 1).map((p) => p.id)
      );

      // ── READ PHASE (ALL READS FIRST) ──────────────────────────────────────

      const [lockSnap, electionSnap, userSnap] = await Promise.all([
        transaction.get(voteLockRef),
        transaction.get(electionRef),
        transaction.get(userRef),
      ]);

      if (!userSnap.exists)     throw new Error("USER_NOT_FOUND");
      if (lockSnap.exists)      throw new Error("ALREADY_VOTED");
      if (!electionSnap.exists) throw new Error("ELECTION_NOT_FOUND");

      const election = electionSnap.data()!;
      if (election.isDeleted)   throw new Error("ELECTION_NOT_FOUND");

      const user = userSnap.data()!;
      const now  = admin.firestore.Timestamp.now();

      const eligibleYears: number[] = election.eligibleAdmissionYears ?? [];
      if (eligibleYears.length > 0) {
        const userAdmissionYear = user.admissionYear as number | undefined;
        if (userAdmissionYear == null) throw new Error("MISSING_ADMISSION_YEAR");
        if (!eligibleYears.includes(userAdmissionYear)) throw new Error("NOT_ELIGIBLE_VOTER");
      }

      if (election.status !== "active")  throw new Error("ELECTION_NOT_ACTIVE");
      if (now < election.votingStartsAt) throw new Error("VOTING_NOT_STARTED");
      if (now > election.votingEndsAt)   throw new Error("VOTING_ENDED");

      // ── Ballot validation ─────────────────────────────────────────────────
      const submittedPositionIds = new Set(voteEntries.map(([positionId]) => positionId));

      for (const positionId of submittedPositionIds) {
        if (!contestedPositionIds.has(positionId)) throw new Error("INVALID_POSITION");
      }
      if (submittedPositionIds.size !== contestedPositionIds.size) {
        throw new Error("INCOMPLETE_BALLOT");
      }

      // Collect ALL candidate refs, then read them before any writes
      const candidateRefs = voteEntries.map(([positionId, candidateId]) =>
        db.collection("elections").doc(electionId)
          .collection("positions").doc(positionId)
          .collection("candidates").doc(candidateId)
      );

      const candidateSnaps = await Promise.all(
        candidateRefs.map((ref) => transaction.get(ref))
      );

      candidateSnaps.forEach((snap) => {
        if (!snap.exists) throw new Error("INVALID_CANDIDATE");
      });

      // ── WRITE PHASE (ONLY WRITES BELOW) ───────────────────────────────────

      transaction.set(voteLockRef, {
        uid,
        electionId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Anonymous receipts — positionId + candidateId both stored
      voteEntries.forEach(([positionId, candidateId]) => {
        transaction.set(db.collection("voteReceipts").doc(), {
          electionId,
          positionId,   // ✅ was: postKey (renamed for consistency)
          candidateId,  // ✅ was: missing entirely
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Tally increments
      candidateRefs.forEach((ref) => {
        transaction.update(ref, {
          voteCount: admin.firestore.FieldValue.increment(1),
        });
      });

      transaction.update(userRef, {
        [`hasVoted.${electionId}`]: true,
        lastVotedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    const [message, status] = ERROR_MAP[error.message] ?? ["Internal Server Error", 500];
    if (status === 500) console.error("[vote] Unhandled error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
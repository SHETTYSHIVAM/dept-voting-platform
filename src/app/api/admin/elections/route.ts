// app/api/admin/elections/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, admin } from "@/lib/firebase/firebase-admin";
import { requireAdmin } from "@/lib/admin-utils";

// ─── GET /api/admin/elections ─────────────────────────────────────────────────
// Returns all elections with totalVoters count
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const snap = await db.collection("elections").where("isDeleted", "==", false).orderBy("createdAt", "desc").get();

    const elections = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();

        // Count how many users have voted in this election
        const votersSnap = await db
          .collection("users")
          .where(`hasVoted.${doc.id}`, "==", true)
          .count()
          .get();

        return {
          id: doc.id,
          title: data.title,
          status: data.status,
          votingStartsAt: data.votingStartsAt?.toDate().toISOString() ?? null,
          votingEndsAt:   data.votingEndsAt?.toDate().toISOString() ?? null,
          resultsPublished: data.resultsPublished ?? false,
          totalVoters: votersSnap.data().count,
          createdAt: data.createdAt?.toDate().toISOString() ?? null,
        };
      })
    );

    return NextResponse.json({ elections });
  } catch (e: any) {
    console.log(e)
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// ─── POST /api/admin/elections ────────────────────────────────────────────────
// Creates a new election + seeds all 16 positions as subcollection
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { title, votingStartsAt, votingEndsAt, eligibleAdmissionYears } = await req.json();

    if (!title || !votingStartsAt || !votingEndsAt) {
      return NextResponse.json({ error: "title, votingStartsAt, votingEndsAt are required" }, { status: 400 });
    }
    if (new Date(votingStartsAt) >= new Date(votingEndsAt)) {
      return NextResponse.json({ error: "Start must be before end" }, { status: 400 });
    }

    const years: number[] = Array.isArray(eligibleAdmissionYears)
      ? eligibleAdmissionYears.filter((y): y is number => typeof y === "number" && y > 2000 && y <= new Date().getFullYear())
      : [];

    if (years.length === 0) {
      return NextResponse.json(
        { error: "At least one eligible admission year is required" },
        { status: 400 }
      );
    }

    const electionRef = db.collection("elections").doc();

    // Seed all positions for Aikya Student Forum
    const DEFAULT_POSITIONS = [
      { title: "President",               yearLabel: "III Year", order: 1  },
      { title: "Vice President",           yearLabel: "II Year",  order: 2  },
      { title: "Secretary",                yearLabel: "III Year", order: 3  },
      { title: "Joint Secretary",          yearLabel: "II Year",  order: 4  },
      { title: "Treasurer",                yearLabel: "III Year", order: 5  },
      { title: "Joint Treasurer",          yearLabel: "II Year",  order: 6  },
      { title: "Technical Lead",           yearLabel: "III Year", order: 7  },
      { title: "Technical Associate",      yearLabel: "II Year",  order: 8  },
      { title: "Cultural Lead",            yearLabel: "III Year", order: 9  },
      { title: "Cultural Associate",       yearLabel: "II Year",  order: 10 },
      { title: "Lead Content Creator",     yearLabel: "III Year", order: 13 },
      { title: "Co-Content Creator",       yearLabel: "II Year",  order: 14 },
      { title: "Social Media Lead",        yearLabel: "III Year", order: 15 },
      { title: "Social Media Associate",   yearLabel: "II Year",  order: 16 },
    ];

    const batch = db.batch();

    batch.set(electionRef, {
      title,
      status: "draft",
      votingStartsAt: admin.firestore.Timestamp.fromDate(new Date(votingStartsAt)),
      votingEndsAt:   admin.firestore.Timestamp.fromDate(new Date(votingEndsAt)),
      resultsPublished: false,
      eligibleAdmissionYears: years,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isDeleted: false
    });

    DEFAULT_POSITIONS.forEach((pos) => {
      const posRef = electionRef.collection("positions").doc();
      batch.set(posRef, {
        ...pos,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    return NextResponse.json({ success: true, electionId: electionRef.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
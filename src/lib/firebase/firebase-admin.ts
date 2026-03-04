import * as admin from "firebase-admin";
import * as functions from 'firebase-functions';
import { onCall, CallableRequest, HttpsError } from "firebase-functions/v2/https";

// 1. Define interfaces for your data structures
interface VoteData {
  candidateId: string;
  electionId: string;
}

interface UserVoteRecord {
  votedAt: admin.firestore.FieldValue;
}

interface AnonymousVote {
  candidateId: string;
  electionId: string;
  timestamp: admin.firestore.FieldValue;
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_KEY as string
)

// Initialize Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
       projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
    }),
  });
}

export const db = admin.firestore();
export {admin};

/**
 * Cloud Function to cast a vote.
 * Uses a transaction to ensure atomic "Check-then-Act" logic.
 */
export const castVote = onCall(async (request: CallableRequest<VoteData>) => {
  
  // 2. Authenticate the user
  if (!request.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in to cast a vote.'
    );
  }

  const userId: string = request.auth.uid;
  const { candidateId, electionId } = request.data;

  // 3. Validation logic remains exactly the same...
  if (!candidateId || typeof candidateId !== 'string' || !electionId || typeof electionId !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      'The function must be called with "candidateId" and "electionId" strings.'
    );
  }

  // Define references
  const userVoteRef = db.collection('elections').doc(electionId).collection('userVotes').doc(userId);
  const votesCollectionRef = db.collection('votes');

  try {
    await db.runTransaction(async (transaction) => {
      // 4. Check if the user has already voted
      const userVoteDoc = await transaction.get(userVoteRef);

      if (userVoteDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'You have already voted in this election.'
        );
      }

      // 5. Create the anonymous vote document
      const newVoteRef = votesCollectionRef.doc(); 
      const anonymousVote: AnonymousVote = {
        candidateId,
        electionId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      transaction.set(newVoteRef, anonymousVote);

      // 6. Record that the user has voted (to prevent duplicates)
      const userRecord: UserVoteRecord = {
        votedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(userVoteRef, userRecord);
    });

    return { success: true, message: 'Vote cast successfully!' };

  } catch (error: unknown) {
    // 7. Type-safe error handling
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    console.error('Error casting vote:', error);
    
    // Fallback for unexpected errors
    throw new functions.https.HttpsError(
      'internal',
      'An unexpected error occurred while casting your vote.',
      error instanceof Error ? error.message : undefined
    );
  }
});

export async function verifyAdmin(idToken: string) {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    // We will check for a custom 'admin' claim
    if (decodedToken.admin === true) {
      return decodedToken;
    }
    throw new Error("Forbidden: Admin access required");
  } catch (error) {
    return null;
  }
}
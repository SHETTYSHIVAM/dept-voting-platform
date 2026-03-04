import { FieldValue, Timestamp } from 'firebase/firestore';

export type UserRole = 'student' | 'admin';
export type StudentYear = '2nd' | '3rd';
export type ElectionStatus = 'draft' | 'active' | 'inactive' | 'expired' | 'results_published';
export type PostYear = '2nd' | '3rd' | 'all';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  year: StudentYear;
  dept: string;
  createdAt: Timestamp | FieldValue;
  rollNo: string;
}

export interface Election {
  id: string;
  title: string;
  description: string;
  status: ElectionStatus;
  startTime: Timestamp;
  endTime: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
}

export interface Post {
  id: string;
  electionId: string;
  title: string;
  description: string;
  year: PostYear;
  precedence: number; // 1 = highest (president)
  createdAt: Timestamp;
}

export interface Candidate {
  id: string;
  postId: string;
  electionId: string;
  name: string;
  photoURL: string;
  tagline: string;
  createdAt: Timestamp;
}

export interface VoteReceipt {
  uid: string;
  electionId: string;
  votedAt: Timestamp;
  postsVoted: string[];
  csrfToken: string;
}

export interface Vote {
  electionId: string;
  postId: string;
  candidateId: string;
  anonymousToken: string;
  votedAt: Timestamp;
}

export interface ResultTally {
  [candidateId: string]: number;
}

export interface ElectionResults {
  electionId: string;
  publishedAt: Timestamp;
  publishedBy: string;
  tallies: {
    [postId: string]: ResultTally;
  };
}

export interface VoteSelection {
  postId: string;
  candidateId: string;
}

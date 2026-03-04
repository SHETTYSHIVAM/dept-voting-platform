import { Suspense } from "react";
import FacultyVotingClient from "./FacultyVotingClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0d0d10] flex items-center justify-center">
          <p className="text-slate-400">Loading voting page...</p>
        </div>
      }
    >
      <FacultyVotingClient />
    </Suspense>
  );
}
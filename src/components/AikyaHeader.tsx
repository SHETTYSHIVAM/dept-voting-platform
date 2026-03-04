"use client";

import { auth } from "@/lib/firebase/firebase";

export default function AikyaHeader() {
  return (
    <header className="border-b border-slate-800/60 px-6 py-4 flex items-center justify-between sticky top-0 bg-[#0d0d10]/95 backdrop-blur z-50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          <img
            src="/Aikya logo.png"
            alt="Aikya Logo"
            className="w-10 h-10 object-contain"
          />
          <div>
            <p className="text-sm font-semibold text-cyan-300 tracking-wide">
              Aikya Student Club
            </p>
            <p className="text-xs text-slate-400">SMVITM</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => auth.signOut()}
          className="text-slate-500 hover:text-white text-xs transition-colors border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-lg"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

"use client";

import { useState } from "react";
import { OPERA_PGN } from "@/app/import/config";

export function ImportView({
  onAnalyze,
}: {
  onAnalyze: (pgn: string) => void;
}) {
  const [pgn, setPgn] = useState("");
  const canSubmit = pgn.trim().length > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pt-8">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-[#EEEEEE]">تحليل مباراة</h1>
        <p className="text-[#8B8F98]">الصق PGN، أو جرّب المثال.</p>
      </header>

      <div className="bg-[#16171B] border border-[#1F2229] p-5 space-y-4">
        <textarea
          value={pgn}
          onChange={(e) => setPgn(e.target.value)}
          placeholder={'[Event "..."]  —  مثال\n1.e4 e5 2.Nf3 ...'}
          className="w-full h-52 p-3 bg-[#0D0E11] border border-[#1F2229] text-[#EEEEEE] text-sm resize-none focus:outline-none focus:border-[#D84040]"
          dir="ltr"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => setPgn(OPERA_PGN)}
            className="text-sm text-[#8B8F98] hover:text-[#EEEEEE] underline transition-colors"
          >
            جرّب مثال — مباراة الأوبرا
          </button>

          <button
            onClick={() => onAnalyze(pgn)}
            disabled={!canSubmit}
            className="bg-[#D84040] hover:bg-[#B83535] disabled:bg-[#3A3D45] disabled:cursor-not-allowed text-white px-6 py-2 font-semibold transition-colors"
          >
            ابدأ التحليل
          </button>
        </div>
      </div>

      <p className="text-xs text-[#6D6D75] text-center leading-relaxed">
        التحليل يعمل في متصفحك — المباراة لا تُرسل إلى أي خادم.
      </p>
    </div>
  );
}

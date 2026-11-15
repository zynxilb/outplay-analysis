"use client";

import { useEffect, useState } from "react";

export function AnalyzingView({
  startedAt,
  onCancel,
}: {
  startedAt: number;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      500,
    );
    return () => clearInterval(t);
  }, [startedAt]);

  return (
    <div className="max-w-md mx-auto text-center space-y-6 pt-20">
      <div className="inline-flex items-center gap-3">
        <span className="w-3 h-3 rounded-full bg-[#D84040] animate-pulse" />
        <h2 className="text-2xl font-bold text-[#EEEEEE]">جاري التحليل…</h2>
      </div>

      <p className="text-sm text-[#8B8F98] leading-relaxed">
        المحرك يفحص كل نقلة. توقّع ١٠-٢٠ ثانية للمباريات القصيرة.
      </p>

      <p className="text-xs text-[#6D6D75] font-mono" dir="ltr">
        {elapsed}s
      </p>

      <button
        onClick={onCancel}
        className="text-sm text-[#8B8F98] hover:text-[#D84040] underline transition-colors"
      >
        إلغاء التحليل
      </button>
    </div>
  );
}

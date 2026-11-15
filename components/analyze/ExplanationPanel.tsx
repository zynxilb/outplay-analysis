"use client";

import type { LocalizedExplanation } from "@/lib/analysis/core/types";

export function ExplanationPanel({
  ply,
  san,
  localized,
}: {
  ply: number;
  san: string | null;
  localized: LocalizedExplanation | undefined;
}) {
  const header = (
    <h3 className="text-xs font-semibold text-[#8B8F98] uppercase tracking-wide">
      الشرح
    </h3>
  );

  if (ply === 0) {
    return (
      <div className="bg-[#16171B] border border-[#1F2229] p-4 space-y-2">
        {header}
        <p className="text-sm text-[#8B8F98]">اختر نقلة لعرض الشرح.</p>
      </div>
    );
  }

  if (!localized) {
    return (
      <div className="bg-[#16171B] border border-[#1F2229] p-4 space-y-2">
        {header}
        <p className="text-sm text-[#8B8F98]">
          لا يوجد شرح متاح لهذه النقلة.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#16171B] border border-[#1F2229] p-4 space-y-3">
      <div className="flex items-center justify-between">
        {header}
        {localized.confidence === "verified" && (
          <span className="text-xs bg-[#7FB069]/15 text-[#7FB069] px-2 py-0.5 rounded">
            مؤكد
          </span>
        )}
      </div>

      <p className="text-[#EEEEEE] leading-relaxed">{localized.text}</p>

      <p className="text-xs text-[#6D6D75] font-mono" dir="ltr">
        ply {ply}{san ? ` · ${san}` : ""}
      </p>
    </div>
  );
}

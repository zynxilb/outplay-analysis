export default function ImportPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl w-full text-center space-y-6">
        <h1 className="text-2xl font-bold text-[#EEEEEE]">تحليل المباراة</h1>
        <div className="bg-[#16171B] border border-[#1F2229] p-8 space-y-4">
          <p className="text-[#C5C7CC]">
            صفحة التحليل قيد الإنشاء.
          </p>
          <p className="text-sm text-[#8B8F98] leading-relaxed">
            Stage 2 (Stockfish adapter) و Stage 3 (Classifier) و Stage 4 (Pipeline)
            و Stage 5 (الشرح العربي) قادمين. الـ contracts الأساسية موجودة، والـ 95 test
            بتتحقق منها.
          </p>
          <div
            className="text-xs text-[#6D6D75] pt-4 border-t border-[#1F2229]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            Status: Stage 1 complete
          </div>
        </div>
      </div>
    </main>
  );
}

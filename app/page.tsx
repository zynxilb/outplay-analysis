import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-[#EEEEEE]">Outplay</h1>
          <p className="text-[#8B8F98]">تحليل شطرنج مبني على الدليل</p>
        </div>

        <div className="bg-[#16171B] border border-[#1F2229] p-6 space-y-3">
          <p className="text-sm text-[#C5C7CC] leading-relaxed">
            تحليل بالعربي، مبني على محرك Stockfish وقواعد شطرنج متحقق منها.
            مفيش هلوسة — لما الدليل ما يكفيش، بنقول &laquo;التحليل غير كافٍ&raquo;.
          </p>
          <p className="text-xs text-[#6D6D75] font-mono" style={{ fontFamily: "var(--font-jetbrains-mono)" }}>
            Stage 1 complete · 95 contract tests passing
          </p>
        </div>

        <Link
          href="/import"
          className="inline-block bg-[#D84040] hover:bg-[#B83535] text-white px-6 py-3 font-semibold transition-colors"
        >
          ابدأ التحليل
        </Link>
      </div>
    </main>
  );
}

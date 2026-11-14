import type { Metadata, Viewport } from "next";
import { Cairo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-cairo",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Outplay — تحليل الشطرنج بالعربي",
  description: "تحليل شطرنج مبني على الدليل. بدون هلوسة. بالعربي.",
};

export const viewport: Viewport = {
  themeColor: "#0D0E11",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${cairo.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-[#0D0E11] text-[#EEEEEE] antialiased">
        {children}
      </body>
    </html>
  );
}

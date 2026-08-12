import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Relocate · AI Relocation OS · built on PAVO",
  description:
    "Call one number. A swarm of 17 AI agents handles your relocation — utilities, movers, flights, USPS, USCIS, DMV — and streams every outcome to a live dashboard.",
  openGraph: {
    title: "Relocate · In one call.",
    description:
      "One phone call. Seventeen agents. Your move, orchestrated.",
    url: "https://vnmoorthy.github.io/relocate-ai/",
    siteName: "Relocate",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

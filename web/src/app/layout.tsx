import type { Metadata } from "next";
import { Syne, Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700", "800"],
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Relocate · AI Relocation OS",
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
    <html lang="en" className={`h-full antialiased ${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}

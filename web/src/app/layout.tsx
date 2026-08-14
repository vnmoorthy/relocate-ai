import type { Metadata } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Condensed industrial display face — uppercase headlines and stat numerals
// only. Body and dashboard UI stay on Geist.
const barlowCondensed = Barlow_Condensed({
  variable: "--font-display-condensed",
  weight: ["300", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const description =
  "One call briefs seventeen AI agents that coordinate your relocation — requesting mover quotes, drafting utility shutoffs and USPS forwarding, and preparing USCIS and DMV forms for your signature.";

export const metadata: Metadata = {
  metadataBase: new URL("https://vnmoorthy.github.io/relocate-ai/"),
  title: "Relocate — AI relocation concierge",
  description,
  openGraph: {
    title: "One call. Seventeen agents.",
    description,
    url: "https://vnmoorthy.github.io/relocate-ai/",
    siteName: "Relocate",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "One call. Seventeen agents.",
    description,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

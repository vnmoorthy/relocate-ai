import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your move — Relocate",
  description:
    "Live tracking for one relocation dispatch — every specialist's honest terminal state on a single shareable page.",
};

export default function MoveLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

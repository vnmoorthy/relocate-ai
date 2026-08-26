import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace — Relocate",
  description:
    "The signed-in Relocate demo workspace: start a real dispatch and watch every specialist's honest terminal state.",
  // A shared demo workspace has nothing to gain from search traffic.
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

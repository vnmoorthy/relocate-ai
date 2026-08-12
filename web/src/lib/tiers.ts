import type { PavoTier } from "./types";

export interface TierMeta {
  key: PavoTier;
  label: string;
  shortLabel: string;
  subtitle: string;
  availabilityLabel: string;
  color: string;
  pillClass: "local" | "flash" | "haiku" | "opus" | "fallback";
}

export const PAVO_TIERS: readonly TierMeta[] = [
  {
    key: "gemma-local",
    label: "Gemma 2-2B",
    shortLabel: "G-2B",
    subtitle: "local · Apple Silicon",
    availabilityLabel: "reference route",
    color: "var(--tier-local)",
    pillClass: "local",
  },
  {
    key: "gemini-flash",
    label: "Gemini Flash 2.5",
    shortLabel: "Gem-FL",
    subtitle: "cloud · Google",
    availabilityLabel: "optional provider",
    color: "var(--tier-flash)",
    pillClass: "flash",
  },
  {
    key: "claude-haiku",
    label: "Claude Haiku",
    shortLabel: "C-HKU",
    subtitle: "cloud · low-latency fallback",
    availabilityLabel: "optional fallback",
    color: "var(--tier-haiku)",
    pillClass: "haiku",
  },
  {
    key: "claude-opus",
    label: "Claude Opus 4.7",
    shortLabel: "C-OPUS",
    subtitle: "cloud · hard escalation",
    availabilityLabel: "optional escalation",
    color: "var(--tier-opus)",
    pillClass: "opus",
  },
  {
    key: "fallback-mock",
    label: "Fallback",
    shortLabel: "FALLBACK",
    subtitle: "synthetic response · degraded mode",
    availabilityLabel: "synthetic / degraded",
    color: "var(--tier-fallback)",
    pillClass: "fallback",
  },
] as const;

const META_BY_KEY = Object.fromEntries(PAVO_TIERS.map((tier) => [tier.key, tier])) as Record<
  PavoTier,
  TierMeta
>;

export function tierMeta(tier: string): TierMeta {
  return META_BY_KEY[tier as PavoTier] ?? META_BY_KEY["fallback-mock"];
}

"use client";

import { useEffect, useState } from "react";

interface Props {
  pavoCents: number;
  baselineCents: number | null;
  decisions: number;
  demoMode: boolean;
}

/**
 * Event-reported routing metrics. A counterfactual baseline is optional; when
 * the backend did not measure or configure one, the UI explicitly says so and
 * does not manufacture a savings claim.
 */
export function CostTicker({ pavoCents, baselineCents, decisions, demoMode }: Props) {
  const pavoUSD = pavoCents / 100;
  const baselineUSD = baselineCents === null ? null : baselineCents / 100;
  const difference = baselineUSD === null ? null : baselineUSD - pavoUSD;

  const pavoSmooth = useSmoothNumber(pavoUSD);
  const baselineSmooth = useSmoothNumber(baselineUSD ?? 0);
  const differenceSmooth = useSmoothNumber(difference ?? 0);

  return (
    <section className="panel-elev overflow-hidden" aria-label="Call cost and routing summary" aria-live="polite">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-[var(--border-soft)]">
        <StatTile
          kicker="Routed cost"
          sub={demoMode ? "estimate" : "event-reported estimate"}
          value={pavoCents === 0 ? "$0.00" : `$${pavoSmooth.toFixed(4)}`}
          accent="var(--mint)"
        />
        <StatTile
          kicker="Fixed-cloud baseline"
          sub={baselineUSD === null ? "no baseline claimed — honest by design" : "reported counterfactual estimate"}
          value={baselineUSD === null ? "—" : `$${baselineSmooth.toFixed(4)}`}
          accent={baselineUSD === null ? "var(--ink-700)" : "var(--ink-300)"}
        />
        <StatTile
          kicker="Estimated difference"
          sub={difference === null ? "no baseline claimed — honest by design" : "counterfactual minus reported cost"}
          value={difference === null ? "—" : formatSignedCurrency(differenceSmooth)}
          accent={difference === null ? "var(--ink-700)" : "var(--cyan)"}
        />
        <StatTile
          kicker="Routing decisions"
          sub="PAVO · gemma → flash → opus"
          value={String(decisions)}
          accent="var(--amber)"
        />
      </div>
      <p className="border-t border-[var(--border-soft)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--ink-500)]">
        <span className="uppercase tracking-[0.14em] text-[9px] text-[var(--ink-500)] mr-2">
          Measurement status
        </span>
        <span className="text-[var(--ink-300)]">
          {baselineUSD === null
            ? "No baseline was reported, so this dashboard makes no savings claim."
            : "A baseline was reported for this event. The difference remains an estimate, not a measured bill reduction."}
        </span>
      </p>
    </section>
  );
}

function StatTile({
  kicker,
  sub,
  value,
  accent,
}: {
  kicker: string;
  sub: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex flex-col justify-center min-w-0 bg-[var(--bg-panel)] px-4 py-3">
      <span className="text-[10px] tracking-[0.12em] text-[var(--ink-500)] uppercase">
        {kicker}
      </span>
      <span
        className="font-mono-tight text-[20px] font-bold leading-tight mt-1 break-words tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </span>
      <span className="text-[10px] text-[var(--ink-500)] mt-0.5 leading-snug">{sub}</span>
    </div>
  );
}

function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toFixed(4)}`;
}

/** Smoothly interpolates toward a target number for cinematic ticker effect. */
function useSmoothNumber(target: number): number {
  const [v, setV] = useState(target);
  useEffect(() => {
    let raf: number;
    const start = v;
    const startedAt = performance.now();
    const dur = 400;
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(start + (target - start) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}

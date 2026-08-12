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
    <section className="panel-elev p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3" aria-label="Call cost and routing summary" aria-live="polite">
      <BigStat
        kicker={demoMode ? "Synthetic routed cost" : "Reported routed cost"}
        sub={demoMode ? "demo estimate · no charge" : "event-reported estimate"}
        value={`$${pavoSmooth.toFixed(4)}`}
        accent="var(--mint)"
      />
      <BigStat
        kicker="Fixed-cloud baseline"
        sub={baselineUSD === null ? "no counterfactual supplied" : "reported counterfactual estimate"}
        value={baselineUSD === null ? "Not measured" : `$${baselineSmooth.toFixed(4)}`}
        accent="var(--ink-500)"
      />
      <BigStat
        kicker="Estimated difference"
        sub={difference === null ? "baseline required" : "counterfactual minus reported cost"}
        value={difference === null ? "Not measured" : formatSignedCurrency(differenceSmooth)}
        accent="var(--cyan)"
      />
      <BigStat
        kicker="Routing decisions"
        sub="PAVO · gemma → flash → opus"
        value={String(decisions)}
        accent="var(--amber)"
      />
      <div className="flex flex-col justify-center min-w-0 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elev)] p-3 sm:col-span-2 xl:col-span-1">
        <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
          Measurement status
        </span>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-300)]">
          {baselineUSD === null
            ? "No baseline was reported, so this dashboard makes no savings claim."
            : "A baseline was reported for this event. The difference remains an estimate, not a measured bill reduction."}
        </p>
      </div>
    </section>
  );
}

function BigStat({
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
    <div className="flex flex-col justify-center min-w-0 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elev)] p-3">
      <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
        {kicker}
      </span>
      <span
        className="font-mono-tight text-[clamp(24px,7vw,34px)] font-bold leading-none mt-1 break-words"
        style={{ color: accent }}
      >
        {value}
      </span>
      <span className="text-[10px] text-[var(--ink-500)] mt-1">{sub}</span>
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

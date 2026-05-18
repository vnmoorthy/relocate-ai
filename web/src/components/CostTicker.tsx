"use client";

import { useEffect, useState } from "react";

interface Props {
  pavoCents: number;
  baselineCents: number;
  decisions: number;
}

/**
 * Bloomberg-terminal-style big-number panel.
 * Four big metrics:
 *   1. Relocate cost (PAVO-routed) — counts up
 *   2. Cloud baseline — counts up faster
 *   3. Savings ratio — derived
 *   4. PAVO paper headline (energy / failures)
 */
export function CostTicker({ pavoCents, baselineCents, decisions }: Props) {
  const pavoUSD = pavoCents / 100;
  const baselineUSD = baselineCents / 100;
  const saved = Math.max(0, baselineUSD - pavoUSD);
  const ratio = pavoUSD > 0 ? baselineUSD / pavoUSD : 0;

  const pavoSmooth = useSmoothNumber(pavoUSD);
  const baselineSmooth = useSmoothNumber(baselineUSD);
  const savedSmooth = useSmoothNumber(saved);

  return (
    <section className="panel-elev px-6 py-4 flex items-stretch justify-between gap-4">
      <BigStat
        kicker="Relocate spend"
        sub="this call · PAVO-routed"
        value={`$${pavoSmooth.toFixed(4)}`}
        accent="var(--mint)"
      />
      <Divider />
      <BigStat
        kicker="Fixed-cloud baseline"
        sub="counterfactual · same turns on Claude-Opus"
        value={`$${baselineSmooth.toFixed(4)}`}
        accent="var(--ink-500)"
        strike
      />
      <Divider />
      <BigStat
        kicker="Saved this call"
        sub={ratio > 1 ? `${ratio.toFixed(1)}× cheaper` : "—"}
        value={`$${savedSmooth.toFixed(4)}`}
        accent="var(--cyan)"
      />
      <Divider />
      <BigStat
        kicker="Routing decisions"
        sub="PAVO · gemma → flash → opus"
        value={String(decisions)}
        accent="var(--amber)"
      />
      <Divider />
      <div className="flex flex-col justify-center min-w-[170px]">
        <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
          From the paper (TMLR 2026)
        </span>
        <ul className="mt-1 space-y-0.5 text-[11px] font-mono-tight text-[var(--ink-300)]">
          <li><span className="text-[var(--mint)]">−25%</span> spend</li>
          <li><span className="text-[var(--mint)]">−34%</span> median latency</li>
          <li><span className="text-[var(--mint)]">−71%</span> energy</li>
          <li><span className="text-[var(--mint)]">7.9×</span> fewer coherence failures</li>
        </ul>
      </div>
    </section>
  );
}

function BigStat({
  kicker,
  sub,
  value,
  accent,
  strike,
}: {
  kicker: string;
  sub: string;
  value: string;
  accent: string;
  strike?: boolean;
}) {
  return (
    <div className="flex flex-col justify-center min-w-[180px]">
      <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
        {kicker}
      </span>
      <span
        className={`font-mono-tight text-[34px] font-bold leading-none mt-1 ${
          strike ? "line-through opacity-70" : ""
        }`}
        style={{ color: accent }}
      >
        {value}
      </span>
      <span className="text-[10px] text-[var(--ink-500)] mt-1">{sub}</span>
    </div>
  );
}

function Divider() {
  return <span className="w-px self-stretch bg-[var(--border-soft)]" />;
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

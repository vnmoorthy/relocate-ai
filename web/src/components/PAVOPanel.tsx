"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface Decision {
  agent_id: string;
  tier: string;
  reason: string;
  turn: number;
  ts: number;
}

const TIER_COLOR: Record<string, string> = {
  "gemma-local": "bg-green-100 text-green-800 border-green-300",
  "gemini-flash": "bg-blue-100 text-blue-800 border-blue-300",
  "claude-haiku": "bg-blue-100 text-blue-800 border-blue-300",
  "claude-opus": "bg-purple-100 text-purple-800 border-purple-300",
  "fallback-mock": "bg-slate-100 text-slate-500 border-slate-300",
};

interface Props {
  decisions: Decision[];
}

export function PAVOPanel({ decisions }: Props) {
  const totalDecisions = decisions.length;
  const localShare = totalDecisions
    ? Math.round(
        (decisions.filter((d) => d.tier === "gemma-local").length / totalDecisions) * 100,
      )
    : 0;

  return (
    <Card className="h-full bg-slate-900 border-slate-700 text-slate-100">
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-wide">PAVO ROUTING (LIVE)</span>
          <span className="text-[10px] text-slate-400">
            Pipeline-Aware Voice Orchestration · TMLR 2026
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-slate-400">decisions</span>
          <span className="text-2xl font-mono font-bold text-emerald-400">{totalDecisions}</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="flex items-center justify-between text-[11px] mb-3 pb-2 border-b border-slate-700">
          <span className="text-slate-400">local tier share</span>
          <span className="font-mono font-bold text-emerald-400">{localShare}%</span>
        </div>
        <div className="space-y-1.5 max-h-[28rem] overflow-y-auto text-[11px] leading-tight font-mono">
          {decisions.length === 0 ? (
            <span className="text-slate-500 italic">No routing decisions yet…</span>
          ) : (
            decisions.map((d, i) => (
              <div key={`${d.ts}-${i}`} className="flex items-start gap-2">
                <Badge
                  className={`shrink-0 text-[9px] px-1.5 py-0 border ${TIER_COLOR[d.tier] ?? ""}`}
                >
                  {d.tier.replace("claude-", "C-").replace("gemma-local", "G-2B").replace("gemini-", "Gem-")}
                </Badge>
                <span className="text-slate-400 shrink-0">{d.agent_id}#{d.turn}</span>
                <span className="text-slate-500 truncate">{d.reason}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

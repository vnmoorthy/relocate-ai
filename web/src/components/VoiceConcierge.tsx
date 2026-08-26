"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  appendTurn,
  conciergeEndUrl,
  conciergeTurnUrl,
  CONDITIONAL_FIELDS,
  CORE_FIELDS,
  detectSpeechSupport,
  fieldLabel,
  missingSummary,
  parseConciergeEnd,
  parseConciergeTurn,
  recognitionErrorMessage,
  type ChatTurn,
} from "@/lib/voice-concierge";

/**
 * Talk to the concierge with the browser microphone.
 *
 * The same agent the phone line runs: speech-to-text happens in this browser,
 * the transcript posts to the orchestrator, and the identical prompt,
 * extraction and dispatch rules apply. Deliberately never labelled as the
 * phone line — it is the same concierge, a different microphone.
 */

// Minimal typings: TS ships no lib for the Speech API.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type Phase = "idle" | "listening" | "thinking" | "speaking";

interface Line {
  role: "user" | "assistant";
  text: string;
  id: number;
}

export interface VoiceConciergeProps {
  api: string;
  demoToken?: string;
  /** Called with the event id once a hang-up dispatches the move. */
  onDispatched: (eventId: string) => void;
}

// Browser capabilities never change within a session, and the snapshot must be
// referentially stable or useSyncExternalStore re-renders forever.
const NO_SPEECH: SpeechSupportSnapshot = { recognition: false, synthesis: false };
let cachedSupport: SpeechSupportSnapshot | null = null;
const subscribeToNothing = () => () => {};
const readSupport = (): SpeechSupportSnapshot => {
  cachedSupport ??= detectSpeechSupport(window as never);
  return cachedSupport;
};

type SpeechSupportSnapshot = { recognition: boolean; synthesis: boolean };

export function VoiceConcierge({ api, demoToken, onDispatched }: VoiceConciergeProps) {
  // Server-rendered markup assumes no speech; hydration fills in the truth.
  const support = useSyncExternalStore(subscribeToNothing, readSupport, () => NO_SPEECH);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [collected, setCollected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [muted, setMuted] = useState(false);
  const [typed, setTyped] = useState("");
  const [ending, setEnding] = useState(false);

  const callId = useRef("");
  const history = useRef<ChatTurn[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const wantsMic = useRef(false);
  const lineId = useRef(0);

  const pushLine = useCallback((role: Line["role"], text: string) => {
    lineId.current += 1;
    const id = lineId.current;
    setLines((prev) => [...prev, { role, text, id }]);
  }, []);

  // ── speech out ──────────────────────────────────────────────────────────
  const speak = useCallback((text: string, onDone: () => void) => {
    if (muted || !window.speechSynthesis || !text) {
      onDone();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => /en-US/i.test(v.lang) && /natural|samantha|google/i.test(v.name))
        ?? voices.find((v) => /en-US/i.test(v.lang));
      if (preferred) utterance.voice = preferred;
      utterance.onend = onDone;
      utterance.onerror = onDone;
      window.speechSynthesis.speak(utterance);
    } catch {
      onDone();
    }
  }, [muted]);

  // ── the turn itself ─────────────────────────────────────────────────────
  const sendTurn = useCallback(async (transcript: string) => {
    const text = transcript.trim();
    if (!text) return;
    setInterim("");
    setNotice("");
    pushLine("user", text);
    history.current = appendTurn(history.current, { role: "user", content: text });
    setPhase("thinking");
    try {
      const body: Record<string, unknown> = { transcript: text, history: history.current };
      if (callId.current) body.call_id = callId.current;
      if (demoToken) body.demo_token = demoToken;
      const res = await fetch(conciergeTurnUrl(api), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        setNotice("That was a lot at once — give it a second and keep going.");
        setPhase("idle");
        return;
      }
      if (!res.ok) throw new Error(`turn http ${res.status}`);
      const turn = parseConciergeTurn(await res.json());
      if (!turn) throw new Error("malformed turn");
      callId.current = turn.callId;
      setCollected(turn.collected);
      pushLine("assistant", turn.text);
      history.current = appendTurn(history.current, { role: "assistant", content: turn.text });
      setPhase("speaking");
      speak(turn.text, () => setPhase("idle"));
    } catch {
      setNotice("Couldn't reach the concierge just then. Try that again.");
      setPhase("idle");
    }
  }, [api, demoToken, pushLine, speak]);

  // ── speech in ───────────────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    wantsMic.current = false;
    try { recognition.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const startListening = useCallback(() => {
    const Ctor = ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition);
    if (!Ctor) return;
    if (recognition.current) {
      try { recognition.current.abort(); } catch { /* noop */ }
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const said = result[0]?.transcript ?? "";
        if (result.isFinal) {
          // Never listen while the agent talks, or the mic transcribes it.
          stopListening();
          void sendTurn(said);
          return;
        }
        partial += said;
      }
      setInterim(partial);
    };
    rec.onerror = (event) => {
      const message = recognitionErrorMessage(event.error);
      if (message) setNotice(message);
      wantsMic.current = false;
      setPhase("idle");
    };
    rec.onend = () => {
      // Chrome ends the session on its own pauses; restart while the user
      // still wants the mic, otherwise settle.
      if (wantsMic.current) {
        try { rec.start(); } catch { /* racing a stop */ }
      } else {
        setPhase((current) => (current === "listening" ? "idle" : current));
      }
    };
    recognition.current = rec;
    wantsMic.current = true;
    try {
      rec.start();
      setPhase("listening");
      setInterim("");
      setNotice("");
    } catch {
      setNotice("Couldn't start the microphone. Check your browser's site settings.");
      setPhase("idle");
    }
  }, [sendTurn, stopListening]);

  // ── session hygiene: a live mic must never outlive the component ────────
  useEffect(() => {
    const teardown = () => {
      wantsMic.current = false;
      try { recognition.current?.abort(); } catch { /* noop */ }
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    };
    const onHide = () => { if (document.hidden) { teardown(); setPhase("idle"); } };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      teardown();
    };
  }, []);

  // ── hang up ─────────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    stopListening();
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    if (!callId.current) return;
    setEnding(true);
    setNotice("");
    try {
      const res = await fetch(conciergeEndUrl(api), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId.current }),
      });
      if (!res.ok) throw new Error(`end http ${res.status}`);
      const end = parseConciergeEnd(await res.json());
      if (!end) throw new Error("malformed end");
      setCollected(end.collected);
      if (end.dispatched) {
        onDispatched(end.eventId);
      } else {
        setNotice(`${missingSummary(end.collected)} Keep talking and it'll dispatch.`.trim());
      }
    } catch {
      setNotice("Couldn't close the briefing just then. Try again.");
    } finally {
      setEnding(false);
      setPhase("idle");
    }
  }, [api, onDispatched, stopListening]);

  const started = lines.length > 0;
  const busy = phase === "thinking" || ending;

  return (
    <div className="vc">
      {/* ── Mic + status ───────────────────────────────────────────── */}
      <div className="vc-bar">
        <div className="flex items-center gap-3 min-w-0">
          {support.recognition ? (
            <button
              type="button"
              className={`vc-mic ${phase === "listening" ? "vc-mic--live" : ""}`}
              onClick={() => (phase === "listening" ? stopListening() : startListening())}
              disabled={busy}
              aria-pressed={phase === "listening"}
            >
              <MicGlyph />
              {phase === "listening" ? "Listening — tap to pause" : started ? "Keep talking" : "Start talking"}
            </button>
          ) : (
            <span className="tm-label text-[var(--text-tertiary)]">Type below</span>
          )}
          <span className="tm-label text-[var(--text-quaternary)] truncate" role="status">
            {phase === "thinking" && "Thinking…"}
            {phase === "speaking" && "Speaking…"}
            {phase === "listening" && "Go ahead"}
            {phase === "idle" && (started ? "Your turn" : "Brief the concierge out loud")}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {support.synthesis && (
            <button type="button" className="vc-ghost" onClick={() => setMuted((m) => !m)}>
              {muted ? "Unmute" : "Mute"}
            </button>
          )}
          {started && (
            <button type="button" className="btn-solid vc-end" onClick={() => void endSession()} disabled={ending}>
              {ending ? "Dispatching…" : "End & dispatch"}
            </button>
          )}
        </div>
      </div>

      {/* ── Where the audio goes ───────────────────────────────────── */}
      <p className="vc-privacy">
        {support.recognition
          ? "Speech-to-text runs in your browser — only the text reaches Relocate. Same concierge the phone line uses, different microphone."
          : "This browser has no speech recognition (Chrome and Edge do). Type your side of the conversation — the concierge behaves identically."}
      </p>

      {/* ── Transcript ─────────────────────────────────────────────── */}
      {(started || interim) && (
        <div className="vc-transcript" aria-live="polite">
          {lines.map((line) => (
            <p key={line.id} className={line.role === "user" ? "vc-you" : "vc-agent"}>
              <span className="tm-label">{line.role === "user" ? "You" : "Concierge"}</span>
              {line.text}
            </p>
          ))}
          {interim && <p className="vc-you vc-interim"><span className="tm-label">You</span>{interim}</p>}
        </div>
      )}

      {notice && <p className="vc-notice" role="status">{notice}</p>}

      {/* ── Typed fallback / correction ────────────────────────────── */}
      <form
        className="vc-type"
        onSubmit={(e) => {
          e.preventDefault();
          const text = typed;
          setTyped("");
          void sendTurn(text);
        }}
      >
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={support.recognition ? "…or type it" : "Tell the concierge about your move"}
          disabled={busy}
          aria-label="Type to the concierge"
        />
        <button type="submit" className="vc-ghost" disabled={busy || !typed.trim()}>Send</button>
      </form>

      {/* ── What the swarm has so far ──────────────────────────────── */}
      <div className="vc-hud">
        <span className="tm-label text-[var(--text-quaternary)]">The brief so far</span>
        <div className="vc-chips">
          {CORE_FIELDS.map((name) => (
            <Chip key={name} label={fieldLabel(name)} on={collected.includes(name)} core />
          ))}
          {CONDITIONAL_FIELDS.map((name) => (
            <Chip key={name} label={fieldLabel(name)} on={collected.includes(name)} />
          ))}
        </div>
        <p className="vc-hud-note">
          Field names only — the concierge never shows your details back on screen.
          The first four have to land before the swarm can go.
        </p>
      </div>
    </div>
  );
}

function Chip({ label, on, core = false }: { label: string; on: boolean; core?: boolean }) {
  return (
    <span className={`vc-chip ${on ? "vc-chip--on" : ""} ${core ? "vc-chip--core" : ""}`}>
      <span className="vc-chip-dot" aria-hidden="true" />
      {label}
      <span className="sr-only">{on ? " — collected" : " — not yet"}</span>
    </span>
  );
}

function MicGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

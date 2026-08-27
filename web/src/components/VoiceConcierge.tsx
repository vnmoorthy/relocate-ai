"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  appendTurn,
  chunkForSpeech,
  conciergeEndUrl,
  conciergeTurnUrl,
  CONDITIONAL_FIELDS,
  CORE_FIELDS,
  detectSpeechSupport,
  fieldLabel,
  joinTurn,
  MAX_SILENT_RESTARTS,
  missingSummary,
  parseConciergeEnd,
  parseConciergeTurn,
  pickVoice,
  RATE_UNKNOWN_VOICE,
  readTranscript,
  recognitionErrorAction,
  recognitionErrorMessage,
  shapeForSpeech,
  SPEECH_PITCH,
  SPEECH_VOLUME,
  speechWatchdogMs,
  synthesisErrorMessage,
  turnFailureMessage,
  TURN_SILENCE_MS,
  type ChatTurn,
  type TranscriptSnapshot,
  type VoiceChoice,
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

/**
 * Chrome and Safari both fill getVoices() asynchronously — measured at ~2 ms
 * after 'voiceschanged' on a warm browser, ~50 ms on a cold one — and the very
 * first call in a page's life returns []. The greeting used to *be* that first
 * call, so the single most important sentence in the product was the one
 * utterance that never got a chosen voice.
 *
 * So warm the list at mount, long before anyone clicks. Three mechanisms
 * because none of them is reliable on its own: a synchronous read for warm
 * loads, the sanctioned event, and a poll because that event has a long
 * history of not firing inside embedded WebViews. The listener stays attached
 * after the list arrives — Safari re-fires it if someone downloads a voice
 * mid-session, and a better voice should win immediately.
 */
const VOICE_WARM_TIMEOUT_MS = 2000;

function warmVoices(onVoices: (voices: SpeechSynthesisVoice[]) => void): () => void {
  const synth = window.speechSynthesis;
  if (!synth) return () => {};
  let poll = 0;
  let timer = 0;
  const stopPolling = () => {
    if (poll) { window.clearInterval(poll); poll = 0; }
    if (timer) { window.clearTimeout(timer); timer = 0; }
  };
  const check = () => {
    const voices = synth.getVoices();
    if (voices.length === 0) return;
    stopPolling();
    onVoices(voices);
  };
  synth.addEventListener("voiceschanged", check);
  poll = window.setInterval(check, 100);
  // Never let this block the greeting. If nothing has landed by now, the
  // engine's own default is a better answer than silence.
  timer = window.setTimeout(stopPolling, VOICE_WARM_TIMEOUT_MS);
  check();
  return () => {
    synth.removeEventListener("voiceschanged", check);
    stopPolling();
  };
}

/**
 * Chrome can garbage-collect an in-flight SpeechSynthesisUtterance together
 * with its event handlers, which strands the queue mid-reply. Holding a hard
 * reference until it ends is the long-standing dodge.
 */
const liveUtterances = new Set<SpeechSynthesisUtterance>();

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

  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const callId = useRef("");
  const history = useRef<ChatTurn[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const wantsMic = useRef(false);
  // One caller turn can span several recognizer sessions: Chrome ends them at
  // will, and no-speech restarts get a fresh instance. `banked` keeps the
  // finals from sessions already gone; `captured` mirrors the live one; the
  // silence timer is what actually ends the turn.
  const banked = useRef("");
  const captured = useRef<TranscriptSnapshot>({ final: "", interim: "" });
  const silenceTimer = useRef(0);
  const restartCount = useRef(0);
  const spawnRef = useRef<() => void>(() => {});
  // sendTurn is declared before startListening, so the hands-free reopen
  // goes through a ref — same pattern as spawnRef.
  const listenRef = useRef<() => void>(() => {});
  // True while a listening stretch has heard nothing at all: exhausting the
  // restart allowance in pure silence is a caller who walked away, not a
  // broken microphone, and the notice should say so.
  const heardNothing = useRef(true);
  const lineId = useRef(0);
  const voiceChoice = useRef<VoiceChoice<SpeechSynthesisVoice> | null>(null);
  // Monotonic: every cancel bumps it, and a chain from an older epoch is
  // provably inert — it can neither speak nor report itself finished.
  const speechEpoch = useRef(0);
  // `muted` also lives in a ref because the recogniser is long-lived: it keeps
  // the handlers it was constructed with, so a captured `muted` would stay
  // stale for the rest of the call — mute worked when typed, not when spoken.
  const mutedRef = useRef(false);

  const pushLine = useCallback((role: Line["role"], text: string) => {
    lineId.current += 1;
    const id = lineId.current;
    setLines((prev) => [...prev, { role, text, id }]);
  }, []);

  // Call timer. Ticks only while a call is up, and is derived from a
  // timestamp so a backgrounded tab cannot drift.
  useEffect(() => {
    if (connectedAt === null) return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - connectedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);

  // ── speech out ──────────────────────────────────────────────────────────

  // Resolve the voice once, at mount. By the time anyone clicks "Start the
  // call" the list is warm and the greeting can pick synchronously — which it
  // has to, because Safari and iOS only honour speak() inside the gesture.
  useEffect(() => {
    if (!support.synthesis) return;
    return warmVoices((voices) => { voiceChoice.current = pickVoice(voices); });
  }, [support.synthesis]);

  /**
   * Stop the concierge talking, from any path.
   *
   * The epoch bump has to come first. cancel() fires an 'interrupted' error on
   * whatever is mid-flight, and without the bump that event would run the
   * *previous* turn's onDone — which meant opening the microphone under the
   * agent's own voice, or reopening it on a backgrounded tab right after the
   * teardown deliberately closed it. Neither is acceptable next to the promise
   * on this page that the mic only runs when the user asked for it.
   */
  const stopSpeaking = useCallback(() => {
    speechEpoch.current += 1;
    liveUtterances.clear();
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  }, []);

  /**
   * The ref is the source of truth for mute; the state exists only to label the
   * button. Muting has to stop the sentence already in progress, not merely the
   * next one — and handing the turn straight back is the honest move, because
   * the reply is already on screen.
   */
  const toggleMute = useCallback(() => {
    const nowMuted = !mutedRef.current;
    mutedRef.current = nowMuted;
    setMuted(nowMuted);
    if (!nowMuted) return;
    stopSpeaking();
    setPhase((current) => (current === "speaking" ? "idle" : current));
  }, [stopSpeaking]);

  /**
   * Speak a reply, one sentence-sized utterance at a time, and call onDone
   * exactly once when the last one lands.
   *
   * Chunking is for prosody first: a whole reply in one utterance is rendered
   * as a single intonation run, so every sentence gets the same flat contour.
   * Spoken one at a time each sentence gets its own closing fall, and the
   * scheduling gap between them reads as a breath. It also keeps every
   * utterance well under the ~15 s watchdog Chrome runs on Windows, which sits
   * directly across the longest line this product says — the one telling the
   * user their move actually dispatched.
   *
   * Note the deps: none. Everything mutable is read through a ref, so this
   * function is stable and no handler can ever close over a stale copy.
   */
  const speak = useCallback((text: string, onDone: () => void) => {
    const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
    const epoch = ++speechEpoch.current;
    if (!synth || mutedRef.current || !text.trim()) {
      onDone();
      return;
    }

    let chunks: string[];
    try {
      // Shaped for pronunciation only. pushLine() keeps the model's exact
      // words, so the transcript and the audio can never drift apart.
      chunks = chunkForSpeech(shapeForSpeech(text));
    } catch {
      onDone();
      return;
    }
    if (chunks.length === 0) {
      onDone();
      return;
    }

    // Only cancel when something is actually queued: a cancel() immediately
    // followed by speak() is a documented Chrome race that can drop the new
    // utterance outright. The greeting has nothing to cancel, so it stays a
    // clean synchronous speak() inside the click.
    try {
      if (synth.speaking || synth.pending) synth.cancel();
    } catch { /* noop */ }

    const choice = voiceChoice.current;
    const rate = choice?.rate ?? RATE_UNKNOWN_VOICE;
    let index = 0;
    let settled = false;

    const settle = () => {
      if (settled || epoch !== speechEpoch.current) return;
      settled = true;
      onDone();
    };

    const next = () => {
      // A superseded chain stays silent and never settles; the newer epoch
      // owns the phase now.
      if (epoch !== speechEpoch.current) return;
      if (index >= chunks.length) {
        settle();
        return;
      }
      const body = chunks[index];
      index += 1;

      const utterance = new SpeechSynthesisUtterance(body);
      liveUtterances.add(utterance);
      if (choice) utterance.voice = choice.voice;
      utterance.rate = rate;
      utterance.pitch = choice?.pitch ?? SPEECH_PITCH;
      utterance.volume = choice?.volume ?? SPEECH_VOLUME;
      // After the voice, never before: once a voice is assigned its language
      // wins anyway, and setting lang first only hides an unassigned voice.
      utterance.lang = utterance.voice?.lang ?? "en-US";

      let finished = false;
      let watchdog = 0;
      const release = () => {
        finished = true;
        window.clearTimeout(watchdog);
        liveUtterances.delete(utterance);
      };
      const advance = () => {
        if (finished) return;
        release();
        next();
      };
      utterance.onend = advance;
      utterance.onerror = (event) => {
        const message = synthesisErrorMessage(event.error);
        // No message means an "interrupted"/"canceled" code. stopSpeaking()
        // bumps the epoch BEFORE it cancels, so if we are still on the current
        // epoch this cancel did not come from us — the OS took the audio
        // (an incoming call, a device change). Settle so the turn comes back
        // to the user instead of the status line reading "Speaking…" forever.
        // When it WAS our own cancel the epoch is already stale and settle()
        // is a no-op, which is the behaviour we want there.
        if (!message) {
          if (!finished) release();
          settle();
          return;
        }
        setNotice(message);
        advance();
      };
      // A stuck synth fires neither end nor error. Without this the status
      // line reads "Speaking…" forever with no audio and no failure — a stall
      // dressed up as progress, which is exactly what this codebase refuses.
      watchdog = window.setTimeout(advance, speechWatchdogMs(body, rate));
      try {
        synth.speak(utterance);
      } catch {
        advance();
      }
    };

    next();
  }, []);

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
        // Chunked replies outlive a fast-failing fetch, so silence the queue
        // before claiming the turn is back — otherwise the notice appears
        // while the concierge is audibly still talking over it.
        stopSpeaking();
        setNotice("That was a lot at once — give it a second and keep going.");
        setPhase("idle");
        return;
      }
      if (res.status === 503) {
        // Every completion provider is down. Chunked replies outlive a
        // fast-failing fetch, so silence the queue before the notice lands.
        stopSpeaking();
        setNotice(turnFailureMessage(503));
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
      speak(turn.text, () => {
        // Hands-free the whole call, exactly like the greeting: the agent
        // finishes talking, the mic opens. Making the caller tap a button
        // between every exchange read as "the call keeps stopping".
        if (support.recognition) listenRef.current();
        else setPhase("idle");
      });
    } catch {
      stopSpeaking();
      setNotice(turnFailureMessage(null));
      setPhase("idle");
    }
  }, [api, demoToken, pushLine, speak, stopSpeaking, support.recognition]);

  // ── speech in ───────────────────────────────────────────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimer.current) {
      window.clearTimeout(silenceTimer.current);
      silenceTimer.current = 0;
    }
  }, []);

  const stopListening = useCallback(() => {
    wantsMic.current = false;
    clearSilenceTimer();
    try { recognition.current?.stop(); } catch { /* already stopped */ }
  }, [clearSilenceTimer]);

  /**
   * The turn ends on SILENCE, not on the engine's first committed segment.
   * Chrome finalizes a segment at every brief pause, so "send on first final"
   * shipped half-sentences and closed the mic mid-thought — the caller said
   * "I'm moving from 1420 Pine Street … [breath]" and the rest was never
   * heard. Now every recognition event re-arms this timer, and only a real
   * stretch of quiet sends what was captured — all of it, banked sessions
   * included.
   */
  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimer.current = window.setTimeout(() => {
      silenceTimer.current = 0;
      // Teardown may have closed the mic between arming and firing.
      if (!wantsMic.current) return;
      const text = joinTurn(banked.current, captured.current);
      if (!text) return; // nothing heard yet — no-speech handling owns silence
      // Sent is sent: without this reset, the hang-up flush re-sent the same
      // words as a second turn (observed live — a call with the whole brief
      // recorded twice, one model round-trip apiece).
      banked.current = "";
      captured.current = { final: "", interim: "" };
      stopListening();
      setInterim("");
      void sendTurn(text);
    }, TURN_SILENCE_MS);
  }, [clearSilenceTimer, sendTurn, stopListening]);

  /**
   * Bring up a FRESH recognizer for the current turn. Always fresh: Chrome
   * ends sessions whenever it likes, and calling start() on one it already
   * shut down either throws or silently does nothing — the mic looked alive
   * ("Listening…") while hearing nothing. A session that ends while the
   * caller still has the floor banks its finals and is replaced, up to
   * MAX_SILENT_RESTARTS in a row; real speech resets the allowance.
   */
  const spawnRecognizer = useCallback(() => {
    const Ctor = ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition);
    if (!Ctor) return;
    if (recognition.current) {
      const old = recognition.current;
      old.onresult = null; old.onerror = null; old.onend = null;
      try { old.abort(); } catch { /* noop */ }
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      restartCount.current = 0; // real audio: the mic is demonstrably alive
      heardNothing.current = false;
      captured.current = readTranscript(event.results);
      // Show the caller everything we hold for this turn, committed or not —
      // seeing your own words appear is what "it's hearing me" feels like,
      // and it's the earliest place a mis-hearing can be caught.
      setInterim(joinTurn(banked.current, captured.current));
      armSilenceTimer();
    };
    rec.onerror = (event) => {
      const action = recognitionErrorAction(event.error);
      if (action === "ignore") return;
      if (action === "restart") return; // onend fires next and handles it
      // Fatal: permissions or hardware. Honesty over optimism.
      wantsMic.current = false;
      clearSilenceTimer();
      const message = recognitionErrorMessage(event.error);
      if (message) setNotice(message);
      setPhase("idle");
    };
    rec.onend = () => {
      if (!wantsMic.current) {
        setPhase((current) => (current === "listening" ? "idle" : current));
        return;
      }
      // The session died mid-turn. Keep its words, replace the instance.
      banked.current = joinTurn(banked.current, { ...captured.current, interim: "" });
      captured.current = { final: "", interim: "" };
      if (restartCount.current >= MAX_SILENT_RESTARTS) {
        wantsMic.current = false;
        clearSilenceTimer();
        setPhase("idle");
        setNotice(heardNothing.current
          ? "Still there? Tap Keep talking when you're ready, or type below."
          : "The microphone keeps cutting out. Tap Keep talking to retry, or type below.");
        return;
      }
      restartCount.current += 1;
      spawnRef.current();
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      setNotice("Couldn't start the microphone. Check your browser's site settings.");
      wantsMic.current = false;
      clearSilenceTimer();
      setPhase("idle");
    }
  }, [armSilenceTimer, clearSilenceTimer]);
  useEffect(() => { spawnRef.current = spawnRecognizer; }, [spawnRecognizer]);

  const startListening = useCallback(() => {
    banked.current = "";
    captured.current = { final: "", interim: "" };
    restartCount.current = 0;
    heardNothing.current = true;
    wantsMic.current = true;
    setPhase("listening");
    setInterim("");
    setNotice("");
    spawnRecognizer();
  }, [spawnRecognizer]);
  useEffect(() => { listenRef.current = startListening; }, [startListening]);

  /**
   * The user tapping "Keep talking" is a barge-in: they want the floor now.
   *
   * The button stays live during "speaking" on purpose — waiting out a reply
   * you have already heard is the worst part of talking to a machine. But the
   * concierge has to actually stop first. Opening the recogniser while it is
   * mid-sentence just transcribes the agent back to itself and posts its own
   * words as the user's turn, which is the whole failure the epoch guard
   * exists to prevent — it only ever closed the automatic path.
   *
   * startListening() owns the phase from here, so there is nothing to reset.
   */
  const takeTheFloor = useCallback(() => {
    stopSpeaking();
    startListening();
  }, [startListening, stopSpeaking]);

  // ── session hygiene: a live mic must never outlive the component ────────
  useEffect(() => {
    const teardown = () => {
      wantsMic.current = false;
      clearSilenceTimer();
      try { recognition.current?.abort(); } catch { /* noop */ }
      stopSpeaking();
    };
    const onHide = () => { if (document.hidden) { teardown(); setPhase("idle"); } };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      teardown();
    };
  }, [clearSilenceTimer, stopSpeaking]);

  // ── hang up ─────────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    // Hanging up must not discard speech the silence timer hadn't sent yet.
    // A real caller said their entire brief and clicked "Hang up & dispatch"
    // half a second later — everything they said was still interim, nothing
    // had been sent, and the hang-up honestly reported an empty call. Flush
    // first: the server merges late turns into the ended call and re-runs
    // the end-of-call dispatch once their fields land.
    const unsent = joinTurn(banked.current, captured.current);
    stopListening();
    stopSpeaking();
    banked.current = "";
    captured.current = { final: "", interim: "" };
    if (unsent) {
      setInterim("");
      void sendTurn(unsent);
      // Give the turn a moment to register the call server-side, so the /end
      // below closes a call that exists rather than an empty one.
      if (!callId.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    }
    if (!callId.current) {
      // No turn ever reached the concierge, so there is no session to close —
      // but the mic and the synth have just been shut down, and leaving "On
      // call" ticking (or the status line reading "Speaking…") would claim a
      // call that is over. End it here and say what actually happened.
      setPhase("idle");
      setConnectedAt(null);
      setNotice("Nothing was captured, so nothing was dispatched.");
      return;
    }
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
      setConnectedAt(null);
    }
  }, [api, onDispatched, sendTurn, stopListening, stopSpeaking]);

  const started = lines.length > 0 || connectedAt !== null;
  const busy = phase === "thinking" || ending;
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  const beginCall = useCallback(() => {
    setConnectedAt(Date.now());
    setElapsed(0);
    // People answer the question they are asked: a route-only greeting gets a
    // route-only answer and costs three more turns. Inviting the whole brief
    // up front is what makes a one-breath call dispatch on turn one.
    const greeting =
      "Relocate here. Tell me where you're moving from, where to, and roughly " +
      "when — and your email, pets, kids or a car if you have them. All in one go is fine.";
    pushLine("assistant", greeting);
    history.current = appendTurn(history.current, { role: "assistant", content: greeting });
    setPhase("speaking");
    speak(greeting, () => {
      // Hands-free from the first second: the concierge opens, then listens.
      if (support.recognition) startListening();
      else setPhase("idle");
    });
  }, [pushLine, speak, startListening, support.recognition]);

  if (!started) {
    return (
      <div className="vc vc-precall">
        <div className="vc-dial">
          <span className="tm-label text-[var(--text-quaternary)]">Relocate concierge</span>
          <p className="vc-dial-num">Talk it through</p>
          <p className="vc-dial-sub">
            Tell it where you&rsquo;re going the way you&rsquo;d tell a person.
            It asks what it still needs, then dispatches the swarm when you
            hang up.
          </p>
          <button type="button" className="vc-call-btn" onClick={beginCall}>
            <MicGlyph />
            Start the call
          </button>
          <p className="vc-privacy">
            {support.recognition
              ? "Runs in this browser — speech-to-text is your browser's, and only the text reaches Relocate. Same concierge the phone line uses, different microphone."
              : "This browser has no speech recognition (Chrome and Edge do). You can hold the same conversation by typing — the concierge behaves identically."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vc">
      {/* ── In-call bar ────────────────────────────────────────────── */}
      <div className="vc-bar vc-bar--live">
        <span className="vc-oncall">
          <span className="vc-oncall-dot" aria-hidden="true" />
          <span className="tm-label">On call</span>
          <span className="vc-clock" aria-label={`Call duration ${clock}`}>{clock}</span>
        </span>
      </div>
      <div className="vc-bar">
        <div className="flex items-center gap-3 min-w-0">
          {support.recognition ? (
            <button
              type="button"
              className={`vc-mic ${phase === "listening" ? "vc-mic--live" : ""}`}
              onClick={() => (phase === "listening" ? stopListening() : takeTheFloor())}
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
            <button type="button" className="vc-ghost" onClick={toggleMute}>
              {muted ? "Unmute" : "Mute"}
            </button>
          )}
          {started && (
            <button type="button" className="btn-solid vc-end" onClick={() => void endSession()} disabled={ending}>
              {ending ? "Dispatching…" : "Hang up & dispatch"}
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

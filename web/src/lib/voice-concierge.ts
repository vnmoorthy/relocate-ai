/**
 * Browser-side concierge: the same voice agent the phone line runs, driven by
 * the microphone in this tab.
 *
 * Speech recognition and synthesis are the browser's own engines — audio never
 * leaves the device; only the resulting transcript is posted to the
 * orchestrator, which runs the identical prompt, extraction and dispatch rules
 * an AgentPhone call would. This is deliberately NOT presented as the phone
 * line: it is the same concierge with a different microphone.
 *
 * Everything here is DOM-free and unit-testable; the React component owns the
 * engines themselves.
 */

// ── API shapes ────────────────────────────────────────────────────────────

export interface ConciergeTurn {
  callId: string;
  text: string;
  eventId: string;
  collected: string[];
  dispatched: boolean;
  turn: number;
}

export interface ConciergeEnd {
  eventId: string;
  dispatched: boolean;
  collected: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function conciergeTurnUrl(api: string): string {
  return `${api}/api/public/concierge/turn`;
}

export function conciergeEndUrl(api: string): string {
  return `${api}/api/public/concierge/end`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Validate an untrusted turn response. Null when fundamentally unusable. */
export function parseConciergeTurn(raw: unknown): ConciergeTurn | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.call_id !== "string" || raw.call_id.length === 0) return null;
  if (typeof raw.text !== "string") return null;
  return {
    callId: raw.call_id,
    text: raw.text,
    eventId: typeof raw.event_id === "string" ? raw.event_id : "",
    collected: stringList(raw.collected),
    dispatched: raw.dispatched === true,
    turn: typeof raw.turn === "number" && Number.isFinite(raw.turn) ? raw.turn : 0,
  };
}

export function parseConciergeEnd(raw: unknown): ConciergeEnd | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.event_id !== "string" || raw.event_id.length === 0) return null;
  return {
    eventId: raw.event_id,
    dispatched: raw.dispatched === true,
    collected: stringList(raw.collected),
  };
}

/**
 * What the reader is told when a turn does not come back.
 *
 * 503 is the orchestrator stating that every completion provider is down.
 * That is a definite, non-retryable failure, and "try that again" would send
 * the reader round a loop that cannot succeed — a stall dressed up as a blip.
 * Anything else, including a fetch that never produced a status at all, may
 * genuinely be transient and is worded that way.
 */
export function turnFailureMessage(status: number | null): string {
  if (status === 503) {
    return "The concierge is unavailable right now — nothing was captured and nothing was dispatched. The typed form below still dispatches the same move.";
  }
  return "Couldn't reach the concierge just then. Try that again.";
}

// ── Conversation state ────────────────────────────────────────────────────

const MAX_HISTORY_TURNS = 12;

/** Append a turn, keeping the tail the API actually reads. */
export function appendTurn(history: ChatTurn[], turn: ChatTurn): ChatTurn[] {
  if (!turn.content.trim()) return history;
  return [...history, turn].slice(-MAX_HISTORY_TURNS);
}

// ── What the swarm still needs ────────────────────────────────────────────

/** CORE fields gate dispatch; the conditionals decide which specialists run. */
export const CORE_FIELDS = [
  "origin_address",
  "destination_address",
  "move_date",
  "user_email",
] as const;

export const CONDITIONAL_FIELDS = ["has_pets", "has_children", "has_car", "has_visa"] as const;

const FIELD_LABELS: Record<string, string> = {
  origin_address: "where you're moving from",
  destination_address: "where you're moving to",
  move_date: "your move date",
  user_email: "your email",
  has_pets: "Pets",
  has_children: "Kids",
  has_car: "Car",
  has_visa: "Visa",
  user_name: "Your name",
  work_address: "Work address",
};

/** Human label for a field name; falls back to a readable form of the name. */
export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name.replace(/_/g, " ");
}

/** CORE fields still missing, in the order the concierge asks for them. */
export function missingCoreFields(collected: string[]): string[] {
  const have = new Set(collected);
  return CORE_FIELDS.filter((name) => !have.has(name));
}

/**
 * Why a hang-up did not dispatch, in the user's words.
 * Only ever derived from what the API reported as collected.
 */
export function missingSummary(collected: string[]): string {
  const missing = missingCoreFields(collected).map(fieldLabel);
  if (missing.length === 0) return "";
  if (missing.length === 1) return `Still need ${missing[0]}.`;
  const last = missing[missing.length - 1];
  return `Still need ${missing.slice(0, -1).join(", ")} and ${last}.`;
}

// ── Speech engines (capability detection only; the component drives them) ──

export interface SpeechCapableWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
}

export interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
}

/** What this browser can actually do. Injectable for tests. */
export function detectSpeechSupport(win: SpeechCapableWindow | undefined): SpeechSupport {
  if (!win) return { recognition: false, synthesis: false };
  return {
    recognition: Boolean(win.SpeechRecognition ?? win.webkitSpeechRecognition),
    synthesis: Boolean(win.speechSynthesis),
  };
}

/** Plain-language explanation for a SpeechRecognition error code. */
export function recognitionErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "This tab can't use the microphone. Allow mic access in your browser's site settings, then start again.";
    case "no-speech":
      return "Didn't catch anything — try again, a little closer to the mic.";
    case "audio-capture":
      return "No microphone found. Check that one is connected and selected.";
    case "network":
      return "The browser's speech service couldn't be reached. Check your connection, or type instead.";
    case "aborted":
      return "";
    default:
      return "Speech recognition stopped unexpectedly. You can keep going by typing.";
  }
}

// ── Speech synthesis: voice choice, pacing, and text shaping ──────────────
//
// Everything below is measured, not guessed. The numbers came from timing
// onstart→onend in a real browser on the demo machine; where a number looks
// arbitrary there is a WHY comment saying what it was measured against.
//
// Same rule as the rest of this file: no DOM types. The component hands us
// whatever getVoices() returned and we rank it structurally, because `npm test`
// runs this under node with no DOM at all.

/** The parts of a SpeechSynthesisVoice we actually rank on. */
export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI?: string;
  /** false means a cloud voice — almost always neural, but needs the network. */
  localService?: boolean;
}

export interface VoiceChoice<T extends VoiceLike = VoiceLike> {
  voice: T;
  rate: number;
  pitch: number;
  volume: number;
}

/**
 * macOS ships two families of voices that must never reach a prospect: the
 * legacy MacinTalk formant voices (Zarvox, Bad News, Trinoids…) and the
 * Eloquence character voices. On the demo Mac, 24 of the 28 installed en-US
 * voices are in this list — so an untargeted `voices.find(en-US)` is a coin
 * flip that can greet someone as "Bad News". Reject before ranking.
 *
 * Safari exposes the real identifier as voiceURI, so we can match the bundle.
 * Chrome sets voiceURI === name, so we also have to match by name.
 */
const NOVELTY_VOICE_URI = /^com\.apple\.(speech\.synthesis\.voice\.|eloquence\.)/i;
const NOVELTY_VOICE_NAME =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

/** Old SAPI5 voices. Usable, but the canonical "robot voice" — rank them last. */
const TIRED_VOICE_NAME = /\b(David|Zira|Mark|eSpeak|Festival|Pico|Compact)\b/i;

/** Apple voice identities worth preferring when the name is all we can see. */
const APPLE_FEMALE_NAME = /^(Ava|Zoe|Allison|Susan|Joelle|Noelle|Nicky|Samantha)\b/i;
const APPLE_MALE_NAME = /^(Tom|Evan|Nathan|Alex|Aaron)\b/i;

/** Lower is better — the numbers are the tiers, best first. */
export const VOICE_TIER = {
  applePremium: 1,
  appleEnhanced: 2,
  microsoftNatural: 3,
  otherNatural: 4,
  chromeNeural: 5,
  googleEnglish: 6,
  appleFemale: 7,
  appleMale: 8,
  samantha: 9,
  anyCloudEnUs: 10,
  anyEnUs: 11,
  anyEnglish: 12,
} as const;

/** Nothing here should ever be spoken; pickVoice drops these entirely. */
export const VOICE_UNUSABLE = Number.POSITIVE_INFINITY;

function isEnUs(lang: string): boolean {
  // Android/Chromium variants report en_US with an underscore. The old regex
  // missed those voices in both branches, which is how a perfectly good voice
  // got skipped on a Pixel.
  return /^en[-_]us$/i.test(lang.trim());
}

function isEnglish(lang: string): boolean {
  return /^en([-_]|$)/i.test(lang.trim());
}

/**
 * Score one voice. Lower wins; VOICE_UNUSABLE means "never speak with this".
 *
 * Ranking has to work off two different views of the same voice: Safari hands
 * back the real `com.apple.voice.premium.…` identifier so the quality tier is
 * readable, while Chrome throws the identifier away and sets voiceURI to the
 * display name — so on Chrome the *name* is the only evidence that someone
 * downloaded a good voice. Check the URI first, fall back to the name.
 */
export function rankVoice(voice: VoiceLike): number {
  const name = voice.name ?? "";
  const uri = voice.voiceURI ?? "";
  const lang = voice.lang ?? "";

  if (!isEnglish(lang)) return VOICE_UNUSABLE;
  if (NOVELTY_VOICE_URI.test(uri) || NOVELTY_VOICE_NAME.test(name)) return VOICE_UNUSABLE;

  const enUs = isEnUs(lang);
  // A tenth of a tier: enough to break a tie, never enough to jump a tier.
  const penalty = TIRED_VOICE_NAME.test(name) ? 0.5 : 0;

  if (enUs && /^com\.apple\.voice\.premium\./i.test(uri)) return VOICE_TIER.applePremium;
  if (enUs && /^com\.apple\.voice\.enhanced\./i.test(uri)) return VOICE_TIER.appleEnhanced;
  if (enUs && /^Microsoft .+ Online \(Natural\)/i.test(name)) return VOICE_TIER.microsoftNatural;
  if (/\bNatural\b/i.test(name)) return VOICE_TIER.otherNatural;
  if (enUs && /^Chrome OS US English(\s\d)?$/i.test(name)) return VOICE_TIER.chromeNeural;
  if (enUs && /^Google US English$/i.test(name)) return VOICE_TIER.googleEnglish;
  if (/^Google (US|UK) English/i.test(name)) return VOICE_TIER.googleEnglish + 0.1;
  if (enUs && APPLE_FEMALE_NAME.test(name)) {
    // Samantha is the one Apple identity that is installed everywhere, and on
    // most Macs it is the low-fidelity *compact* build. The others only exist
    // if a human downloaded them, which is strong evidence of an Enhanced or
    // Premium asset — so they outrank her.
    return /^Samantha\b/i.test(name) ? VOICE_TIER.samantha : VOICE_TIER.appleFemale;
  }
  if (enUs && APPLE_MALE_NAME.test(name)) return VOICE_TIER.appleMale;
  if (enUs && voice.localService === false) return VOICE_TIER.anyCloudEnUs + penalty;
  if (enUs) return VOICE_TIER.anyEnUs + penalty;
  return VOICE_TIER.anyEnglish + penalty;
}

/**
 * Rate is not one number. macOS quantises the rate axis hard (0.75/0.80/0.85
 * are literally the same bucket, and 0.92 is indistinguishable from 1.0), and
 * Apple voices at the default rate run ~205 wpm — auctioneer pace. Measured
 * steps that actually differ are ~0.85, ~0.7, ~0.6; 0.7 lands on 170 wpm,
 * which is unhurried without dragging.
 *
 * Google/Microsoft neural voices are roughly linear and already sit near
 * conversational pace at 1.0, so the same 0.7 would sound sedated on them.
 */
const RATE_APPLE = 0.7;
const RATE_NEURAL = 0.95;
export const RATE_UNKNOWN_VOICE = 0.85;

/** Pitch stays at 1.0: Apple's compact/enhanced voices are concatenative, and
 * shifting pitch introduces formant artefacts — the exact "processed" sound we
 * are trying to remove. Warmth here comes from rate and pauses, not pitch.
 * Volume stays at 1.0 so the OS owns loudness. */
export const SPEECH_PITCH = 1;
export const SPEECH_VOLUME = 1;

export function rateForVoice(voice: VoiceLike): number {
  const name = voice.name ?? "";
  const uri = voice.voiceURI ?? "";
  if (/^com\.apple\./i.test(uri)) return RATE_APPLE;
  if (/\bNatural\b/i.test(name) || /^(Google|Chrome OS)\b/i.test(name)) return RATE_NEURAL;
  if (APPLE_FEMALE_NAME.test(name) || APPLE_MALE_NAME.test(name)) return RATE_APPLE;
  if (/^Microsoft\b/i.test(name)) return RATE_UNKNOWN_VOICE;
  return RATE_UNKNOWN_VOICE;
}

/**
 * Best voice this browser can offer, with the pacing that voice needs.
 * Null means "let the engine use its default" — which is still better than
 * the old fallback of grabbing the first en-US entry in an array whose order
 * is not contractual.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): VoiceChoice<T> | null {
  let best: T | null = null;
  let bestRank = VOICE_UNUSABLE;
  for (const voice of voices) {
    if (!voice || typeof voice.name !== "string" || typeof voice.lang !== "string") continue;
    const rank = rankVoice(voice);
    // Strictly less-than keeps it stable: first listed wins a tie, so the
    // choice does not flip between reloads.
    if (rank < bestRank) {
      best = voice;
      bestRank = rank;
    }
  }
  if (!best) return null;
  return { voice: best, rate: rateForVoice(best), pitch: SPEECH_PITCH, volume: SPEECH_VOLUME };
}

// ── Speech shaping ────────────────────────────────────────────────────────
//
// Pronunciation only. This never runs on anything the user reads: pushLine()
// keeps the model's exact words, and only the utterance gets the shaped copy,
// so the transcript and the audio can never drift apart. Expansion is allowed,
// invention is not — no filler, no words the model did not say.
//
// Punctuation is the only pause lever the Web Speech API actually supports.
// SSML is not part of the spec and some engines read the tags out loud, which
// would be a spectacular demo failure. Measured pause costs at rate 0.7:
// comma ≈345 ms, period ≈384 ms, em-dash ≈300 ms.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Generated ordinals go wrong at eleventh/twelfth/twentieth often enough that a
// table is simply cheaper to trust than a rule.
const ORDINALS = [
  "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
  "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth",
  "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second",
  "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh",
  "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first",
];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    return rest ? `${TENS[Math.floor(n / 10)]}-${ONES[rest]}` : TENS[Math.floor(n / 10)];
  }
  const head = `${ONES[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest ? `${head} ${underThousand(rest)}` : head;
}

function numberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 1000) return underThousand(n);
  if (n < 1_000_000) {
    const head = `${underThousand(Math.floor(n / 1000))} thousand`;
    const rest = n % 1000;
    return rest ? `${head} ${underThousand(rest)}` : head;
  }
  return String(n); // Nothing this concierge says out loud gets this big.
}

/** Years are read in pairs, not as cardinals: 2026 is "twenty twenty-six". */
function yearWords(year: number): string {
  if (year >= 2000 && year <= 2009) {
    return year === 2000 ? "two thousand" : `two thousand ${ONES[year - 2000]}`;
  }
  if (year >= 1000 && year <= 9999) {
    const high = Math.floor(year / 100);
    const low = year % 100;
    if (low === 0) return `${underThousand(high)} hundred`;
    if (low < 10) return `${underThousand(high)} oh ${ONES[low]}`;
    return `${underThousand(high)} ${underThousand(low)}`;
  }
  return numberWords(year);
}

/** Digit-by-digit, with "oh" for zero — how a person dictates a number. */
function digitWords(digits: string): string {
  return digits
    .split("")
    .map((d) => (d === "0" ? "oh" : ONES[Number(d)]))
    .join(" ");
}

/** 1200 → "twelve hundred", 1234 → "twelve thirty-four", 405 → "four oh five". */
function houseNumberWords(digits: string): string {
  const n = Number(digits);
  if (digits.length === 4) return yearWords(n);
  if (digits.length === 3) {
    const high = Math.floor(n / 100);
    const low = n % 100;
    if (low === 0) return `${ONES[high]} hundred`;
    if (low < 10) return `${ONES[high]} oh ${ONES[low]}`;
    return `${ONES[high]} ${underThousand(low)}`;
  }
  return numberWords(n);
}

function spokenDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${ORDINALS[day]}, ${yearWords(year)}`;
}

const STREET_TYPES: Record<string, string> = {
  st: "Street", ave: "Avenue", blvd: "Boulevard", rd: "Road", dr: "Drive", ln: "Lane",
  ct: "Court", pl: "Place", pkwy: "Parkway", hwy: "Highway", ter: "Terrace",
};
const DIRECTIONALS: Record<string, string> = {
  n: "North", s: "South", e: "East", w: "West",
  ne: "Northeast", nw: "Northwest", se: "Southeast", sw: "Southwest",
};
const UNIT_WORDS: Record<string, string> = {
  apt: "apartment", ste: "suite", bldg: "building", fl: "floor",
};
// Hand-curated on purpose. A heuristic like "all caps means spell it out"
// wrecks legitimate words and shouty emphasis; this list is this product's
// vocabulary and nothing else.
const ACRONYMS: Record<string, string> = {
  HOA: "H O A", DMV: "D M V", USPS: "U S P S", USCIS: "U S C I S", HVAC: "H V A C",
  ETA: "E T A", PDF: "P D F", FAQ: "F A Q",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, "$1");
}

/**
 * Rewrite a reply so an en-US engine pronounces it the way a person would.
 * Never changes meaning, never drops a clause, never adds a word the model
 * did not say.
 */
export function shapeForSpeech(text: string): string {
  if (!text) return "";
  let out = stripMarkdown(text);

  // A paragraph break should read as a sentence break, not vanish.
  out = out.replace(/\n{2,}/g, ". ").replace(/\n/g, ". ").replace(/\.\s*\.\s*/g, ". ");

  // Engines disagree about the em dash — some pause, some run the clauses
  // straight together. A comma is the one pause every engine honours, and it
  // is what the greeting and the dispatch closing both hang on.
  out = out.replace(/\s*[—–]\s*/g, ", ");

  // Emails first, before anything generic touches a period: the dots in a
  // local part are not sentence ends, and letting the chunker treat them that
  // way splits an address across two utterances.
  out = out.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    (address) =>
      `, ${address
        .replace(/@/g, " at ")
        .replace(/\./g, " dot ")
        .replace(/_/g, " underscore ")
        .replace(/-/g, " dash ")
        .replace(/\+/g, " plus ")
        .replace(/\s+/g, " ")
        .trim()}, `,
  );

  out = out.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, (url) =>
    url
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/g, "")
      .replace(/\//g, " slash ")
      .replace(/\./g, " dot ")
      .replace(/\s+/g, " ")
      .trim(),
  );

  // The commas between groups are load-bearing: ~345 ms each is the difference
  // between a dictated number and a machine-gunned one.
  out = out.replace(
    /\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,
    (_m, a: string, b: string, c: string) => `${digitWords(a)}, ${digitWords(b)}, ${digitWords(c)}`,
  );

  out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (whole, y: string, m: string, d: string) =>
    spokenDate(Number(y), Number(m), Number(d)) ?? whole);
  out = out.replace(
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g,
    (whole, m: string, d: string, y: string | undefined) => {
      const month = Number(m);
      const day = Number(d);
      if (month < 1 || month > 12 || day < 1 || day > 31) return whole;
      if (!y) return `${MONTHS[month - 1]} ${ORDINALS[day]}`;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      return spokenDate(year, month, day) ?? whole;
    },
  );

  // Anchored on the state code so this can never swallow a house number.
  out = out.replace(/\b([A-Z]{2}) (\d{5})\b/g, (_m, state: string, zip: string) =>
    `${state} ${digitWords(zip)}`);

  out = out.replace(
    /\$(\d[\d,]*)(?:\.(\d{2}))?/g,
    (_m, whole: string, cents: string | undefined) => {
      const dollars = numberWords(Number(whole.replace(/,/g, "")));
      if (!cents || cents === "00") return `${dollars} dollars`;
      return `${dollars} dollars and ${numberWords(Number(cents))} cents`;
    },
  );

  out = out.replace(
    /\b(\d{1,2}):(\d{2})\s*([ap])\.?\s?m\.?\b/gi,
    (_m, h: string, min: string, ap: string) => {
      const hour = numberWords(Number(h));
      const meridiem = ap.toLowerCase() === "a" ? "AM" : "PM";
      if (min === "00") return `${hour} ${meridiem}`;
      const minutes = Number(min) < 10 ? `oh ${ONES[Number(min)]}` : numberWords(Number(min));
      return `${hour} ${minutes} ${meridiem}`;
    },
  );

  // Numbered streets and plain ordinals share the same table.
  out = out.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, (whole, n: string) =>
    ORDINALS[Number(n)] ?? whole);

  // Address abbreviations. Deliberately conservative: a directional only
  // expands right after a house number, and a street type only expands when it
  // is NOT followed by a capitalised word — so "Dr. Chen" stays a person and
  // "1200 Congress Ave, Austin" becomes an avenue.
  out = out.replace(/(?<=\b\d{1,6}\s)(N|S|E|W|NE|NW|SE|SW)\b\.?/g, (_m, d: string) =>
    DIRECTIONALS[d.toLowerCase()]);
  out = out.replace(
    /(?<=\w\s)(St|Ave|Blvd|Rd|Dr|Ln|Ct|Pl|Pkwy|Hwy|Ter)\.?(?=\s*(?:,|$|\s[a-z0-9]))/g,
    (_m, t: string) => STREET_TYPES[t.toLowerCase()],
  );
  out = out.replace(/\b(Apt|Ste|Bldg|Fl)\.?(?=\s+[\dA-Za-z])/gi, (_m, u: string) =>
    UNIT_WORDS[u.toLowerCase()]);
  // "apartment 3B" → "apartment three B"; only right after a unit word, so a
  // model number somewhere else in the sentence is left alone.
  out = out.replace(
    /\b(apartment|suite|unit)\s+(\d{1,3})([A-Za-z])\b/gi,
    (_m, word: string, n: string, letter: string) =>
      `${word} ${numberWords(Number(n))} ${letter.toUpperCase()}`,
  );
  // House numbers are read in pairs, never digit by digit: "twelve hundred",
  // not "one two zero zero". Anchored on an actual street type further down the
  // line so a bare number in a sentence is never mistaken for an address.
  out = out.replace(
    /\b(\d{3,5})\s+(?=(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest|[A-Z][a-z]+|[a-z]+)\s+(?:\S+\s+)?(?:Street|Avenue|Boulevard|Road|Drive|Lane|Court|Place|Parkway|Highway|Terrace)\b)/g,
    (_m, n: string) => `${houseNumberWords(n)} `,
  );

  out = out
    .replace(/\bsq\.?\s?ft\.?/gi, "square feet")
    .replace(/\blbs?\.?\b/gi, "pounds")
    .replace(/\bhrs\.?\b/gi, "hours")
    .replace(/\bapprox\./gi, "approximately")
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\betc\./gi, "et cetera")
    .replace(/\bvs\./gi, "versus");

  out = out.replace(/\b[A-Z]{2,6}\b/g, (word) => ACRONYMS[word] ?? word);

  // One comma after an opener is ~345 ms, and it is the whole difference
  // between a warm "Got it, ..." and a clipped one.
  out = out.replace(/^(Okay|OK|Alright|Right|Sure|Perfect|Great|Got it|Nice|Good)(\s+)/i,
    (_m, opener: string, gap: string) => `${opener},${gap}`);
  out = out.replace(/(\w)\s+(right|correct)\?/gi, (_m, w: string, tag: string) => `${w}, ${tag}?`);

  out = out
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    // The email and phone rules bracket their output with commas so the digits
    // get a pause on both sides. When the address ends the sentence that
    // closing comma lands on top of the period — ",." — and the tired SAPI
    // voices read that punctuation out loud. Let the terminator win.
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  // A final terminator buys the closing fall; without it the last chunk trails
  // off flat, which is exactly what "robotic" sounds like.
  if (out && !/[.!?…]$/.test(out)) out += ".";
  return out;
}

// ── Chunking ──────────────────────────────────────────────────────────────

/** Measured throughput at rate 0.7 is ~14.4 chars/sec, so 160 chars ≈ 11 s —
 * comfortably under the ~15 s watchdog Chrome runs on Windows and Linux, and
 * short enough that interrupting the concierge never means waiting out a
 * paragraph. */
export const CHUNK_TARGET_CHARS = 160;
/** Below this a chunk lands as staccato ("Got it." on its own), so it gets
 * merged into its neighbour. */
const CHUNK_MIN_CHARS = 40;

/**
 * A period after one of these is an abbreviation, not the end of a sentence.
 * Without this, "Dr. Chen" and "e.g. Austin" get split across two utterances
 * and the pause lands in the middle of a name.
 */
const SENTENCE_BREAK =
  /(?<=[.!?…])(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|St|Ave|Blvd|Rd|Ln|Ct|Apt|Ste|Bldg|Jr|Sr|vs|etc|approx|No|Inc|Co|Ext|e\.g|i\.e|a\.m|p\.m|U\.S|[A-Z])\.)\s+(?=["'“‘(]?[A-Z0-9])/g;

// Clause fallbacks, in the order a person would breathe.
const CLAUSE_SEMICOLON = /(?<=[;:])\s+/g;
const CLAUSE_DASH = /\s+(?=[—–]\s)/g;
const CLAUSE_COMMA = /(?<=,)\s+/g;
const ANY_SPACE = /\s+/g;
const SEPARATORS = [CLAUSE_SEMICOLON, CLAUSE_DASH, CLAUSE_COMMA, ANY_SPACE];

/** Split on a whitespace delimiter, keeping every non-whitespace character. */
function splitAt(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    const head = text.slice(cursor, at);
    if (head) out.push(head);
    cursor = at + match[0].length;
  }
  const tail = text.slice(cursor);
  if (tail) out.push(tail);
  return out;
}

/** Greedily refill pieces up to the cap, rejoining with the space we removed. */
function repack(pieces: string[], max: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece;
    } else if (current.length + 1 + piece.length <= max) {
      current = `${current} ${piece}`;
    } else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

function subdivide(part: string, max: number, level: number): string[] {
  if (part.length <= max || level >= SEPARATORS.length) return [part];
  const pieces = splitAt(part, SEPARATORS[level]);
  if (pieces.length <= 1) return subdivide(part, max, level + 1);
  return repack(pieces, max).flatMap((piece) =>
    piece.length <= max ? [piece] : subdivide(piece, max, level + 1));
}

/**
 * A short *fragment* — a clause left over from sub-splitting — delivered on its
 * own is the staccato that reads as robotic, so it gets glued to what follows.
 * A short *sentence* is different: it already ends in a terminator, so it earns
 * its own closing fall and is left alone.
 */
function isStub(chunk: string): boolean {
  return chunk.length < CHUNK_MIN_CHARS && !/[.!?…]$/.test(chunk);
}

function mergeShort(chunks: string[], max: number): string[] {
  const out: string[] = [];
  for (const chunk of chunks) {
    const previous = out[out.length - 1];
    if (previous !== undefined && isStub(previous) && previous.length + 1 + chunk.length <= max) {
      out[out.length - 1] = `${previous} ${chunk}`;
    } else {
      out.push(chunk);
    }
  }
  // A stub with nothing after it has to go backwards instead.
  if (out.length > 1 && isStub(out[out.length - 1])) {
    const tail = out.pop() as string;
    const head = out[out.length - 1];
    if (head.length + 1 + tail.length <= max) out[out.length - 1] = `${head} ${tail}`;
    else out.push(tail);
  }
  return out;
}

/**
 * Split a reply into utterance-sized pieces, sentence boundaries first.
 *
 * This is for prosody as much as for safety: one long utterance is rendered as
 * a single intonation run, so every sentence gets the same flat contour. Spoken
 * one at a time, each sentence gets its own closing fall, and the ~150 ms gap
 * the engine leaves between them reads as a breath.
 *
 * chunks.join(" ") always equals the whitespace-normalised input — the reply is
 * never reordered and never silently dropped. The one exception to the cap is a
 * single unbroken token (a long URL): splitting mid-token sounds far worse than
 * one long chunk, so it is emitted intact.
 */
export function chunkForSpeech(text: string, maxChars: number = CHUNK_TARGET_CHARS): string[] {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const cap = Math.max(1, maxChars);
  const sized = splitAt(normalized, SENTENCE_BREAK).flatMap((s) => subdivide(s, cap, 0));
  return mergeShort(sized, cap);
}

// ── Watchdog arithmetic ───────────────────────────────────────────────────

/** Measured on the demo Mac: rate 0.7 with Samantha runs ~170 wpm ≈ 14.4
 * chars/sec. Rate scales throughput roughly linearly within one engine. */
const CHARS_PER_SECOND_AT_BASE_RATE = 14.4;
const BASE_RATE = 0.7;

/** Roughly how long this text will take to speak, in ms. */
export function estimateSpeechMs(text: string, rate: number = BASE_RATE): number {
  const chars = (text ?? "").trim().length;
  if (!chars) return 0;
  const safeRate = rate > 0 ? rate : BASE_RATE;
  return Math.round((chars / CHARS_PER_SECOND_AT_BASE_RATE) * 1000 * (BASE_RATE / safeRate));
}

/**
 * How long to wait before deciding the engine swallowed an utterance.
 *
 * Generous on purpose: a false trigger cuts the concierge off mid-word, while
 * a late trigger only costs a couple of seconds. But it has to exist — without
 * it a stuck synth leaves the UI reading "Speaking…" forever with no audio and
 * no failure, which is precisely the kind of dressed-up stall this codebase
 * refuses to ship.
 */
export function speechWatchdogMs(text: string, rate: number = BASE_RATE): number {
  return estimateSpeechMs(text, rate) * 2 + 3000;
}

/** Plain-language explanation for a SpeechSynthesis error code. */
export function synthesisErrorMessage(code: string): string {
  switch (code) {
    // We cancel on every new turn, on mute, and on teardown. Our own doing.
    case "interrupted":
    case "canceled":
      return "";
    case "network":
      return "This browser's voice is a cloud voice and couldn't be reached. The reply is above — the call still works.";
    case "synthesis-failed":
    case "synthesis-unavailable":
    case "voice-unavailable":
    case "language-unavailable":
      return "This browser couldn't speak that out loud. The reply is above — keep going by typing or talking.";
    case "audio-busy":
    case "audio-hardware":
      return "Something else has the audio output. The reply is above.";
    case "not-allowed":
      return "This tab isn't allowed to play audio yet. The reply is above.";
    default:
      return "The browser's voice stopped unexpectedly. The reply is above.";
  }
}

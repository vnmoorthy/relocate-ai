import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTurn,
  chunkForSpeech,
  detectSpeechSupport,
  estimateSpeechMs,
  fieldLabel,
  missingCoreFields,
  missingSummary,
  parseConciergeEnd,
  parseConciergeTurn,
  pickVoice,
  rankVoice,
  recognitionErrorMessage,
  shapeForSpeech,
  speechWatchdogMs,
  synthesisErrorMessage,
  turnFailureMessage,
  VOICE_UNUSABLE,
  type VoiceLike,
} from "./voice-concierge.ts";

test("parseConciergeTurn: valid payload maps through", () => {
  const turn = parseConciergeTurn({
    call_id: "web_abc123",
    text: "SF to Austin, cool — when's the move?",
    event_id: "mkt_1",
    collected: ["origin_address", "destination_address"],
    dispatched: false,
    turn: 2,
  });
  assert.ok(turn);
  assert.equal(turn.callId, "web_abc123");
  assert.equal(turn.eventId, "mkt_1");
  assert.deepEqual(turn.collected, ["origin_address", "destination_address"]);
  assert.equal(turn.dispatched, false);
});

test("parseConciergeTurn: malformed payloads degrade safely", () => {
  assert.equal(parseConciergeTurn(null), null);
  assert.equal(parseConciergeTurn({ text: "hi" }), null); // no call_id
  assert.equal(parseConciergeTurn({ call_id: "web_a" }), null); // no text
  const partial = parseConciergeTurn({ call_id: "web_a", text: "hi", collected: "nope" });
  assert.ok(partial);
  assert.deepEqual(partial.collected, []);
  assert.equal(partial.dispatched, false);
});

test("parseConciergeEnd: requires an event id", () => {
  assert.equal(parseConciergeEnd({ dispatched: true }), null);
  const end = parseConciergeEnd({ event_id: "mkt_2", dispatched: true, collected: ["move_date"] });
  assert.ok(end);
  assert.equal(end.eventId, "mkt_2");
  assert.equal(end.dispatched, true);
});

test("appendTurn: skips empty content and keeps the recent tail", () => {
  let history = appendTurn([], { role: "user", content: "  " });
  assert.equal(history.length, 0);
  history = appendTurn(history, { role: "user", content: "moving to Austin" });
  assert.equal(history.length, 1);
  for (let i = 0; i < 20; i += 1) {
    history = appendTurn(history, { role: "assistant", content: `reply ${i}` });
  }
  assert.equal(history.length, 12);
  assert.equal(history[history.length - 1].content, "reply 19");
});

test("missingCoreFields: only the four that gate dispatch, in ask order", () => {
  assert.deepEqual(missingCoreFields([]), [
    "origin_address",
    "destination_address",
    "move_date",
    "user_email",
  ]);
  assert.deepEqual(
    missingCoreFields(["origin_address", "destination_address", "has_pets"]),
    ["move_date", "user_email"],
  );
  assert.deepEqual(
    missingCoreFields(["origin_address", "destination_address", "move_date", "user_email"]),
    [],
  );
});

test("missingSummary: reads like a person, empty when ready", () => {
  assert.equal(missingSummary(["origin_address", "destination_address", "move_date", "user_email"]), "");
  assert.equal(
    missingSummary(["origin_address", "destination_address", "move_date"]),
    "Still need your email.",
  );
  assert.equal(
    missingSummary(["origin_address"]),
    "Still need where you're moving to, your move date and your email.",
  );
});

test("fieldLabel: known fields read plainly, unknown ones degrade", () => {
  assert.equal(fieldLabel("user_email"), "your email");
  assert.equal(fieldLabel("has_pets"), "Pets");
  assert.equal(fieldLabel("some_new_field"), "some new field");
});

test("detectSpeechSupport: both vendor prefixes, and no window at all", () => {
  assert.deepEqual(detectSpeechSupport(undefined), { recognition: false, synthesis: false });
  assert.deepEqual(detectSpeechSupport({}), { recognition: false, synthesis: false });
  assert.deepEqual(detectSpeechSupport({ webkitSpeechRecognition: class {} }), {
    recognition: true,
    synthesis: false,
  });
  assert.deepEqual(detectSpeechSupport({ SpeechRecognition: class {}, speechSynthesis: {} }), {
    recognition: true,
    synthesis: true,
  });
});

test("recognitionErrorMessage: actionable text, silent on deliberate aborts", () => {
  assert.match(recognitionErrorMessage("not-allowed"), /site settings/);
  assert.match(recognitionErrorMessage("audio-capture"), /No microphone/);
  assert.equal(recognitionErrorMessage("aborted"), "");
  assert.match(recognitionErrorMessage("weird-code"), /typing/);
});

// ── Voice ranking ─────────────────────────────────────────────────────────
//
// Fixtures are real voice lists, captured from the browsers this actually
// ships to. Safari exposes the com.apple identifier so the quality tier is
// readable; Chrome sets voiceURI to the display name and hides the tier, which
// is why the same voice needs two different ways of being recognised.

const MAC_SAFARI: VoiceLike[] = [
  { name: "Albert", lang: "en-US", voiceURI: "com.apple.speech.synthesis.voice.Albert", localService: true },
  { name: "Zarvox", lang: "en-US", voiceURI: "com.apple.speech.synthesis.voice.Zarvox", localService: true },
  { name: "Grandma", lang: "en-US", voiceURI: "com.apple.eloquence.en-US.Grandma", localService: true },
  { name: "Samantha", lang: "en-US", voiceURI: "com.apple.voice.compact.en-US.Samantha", localService: true },
  { name: "Ava", lang: "en-US", voiceURI: "com.apple.voice.premium.en-US.Ava", localService: true },
];

const MAC_CHROME: VoiceLike[] = [
  { name: "Bad News", lang: "en-US", voiceURI: "Bad News", localService: true },
  { name: "Eddy (English (United States))", lang: "en-US", voiceURI: "Eddy (English (United States))", localService: true },
  { name: "Samantha", lang: "en-US", voiceURI: "Samantha", localService: true },
];

const WINDOWS_SAPI_ONLY: VoiceLike[] = [
  { name: "Microsoft David - English (United States)", lang: "en-US", voiceURI: "Microsoft David", localService: true },
  { name: "Microsoft Zira - English (United States)", lang: "en-US", voiceURI: "Microsoft Zira", localService: true },
];

const WINDOWS_WITH_NATURAL: VoiceLike[] = [
  ...WINDOWS_SAPI_ONLY,
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", voiceURI: "Microsoft Aria", localService: false },
];

test("rankVoice: novelty and formant voices are rejected outright", () => {
  // By identifier (Safari) …
  assert.equal(rankVoice(MAC_SAFARI[0]), VOICE_UNUSABLE);
  assert.equal(rankVoice(MAC_SAFARI[1]), VOICE_UNUSABLE);
  assert.equal(rankVoice(MAC_SAFARI[2]), VOICE_UNUSABLE);
  // … and by name, which is all Chrome gives us.
  assert.equal(rankVoice(MAC_CHROME[0]), VOICE_UNUSABLE);
  assert.equal(rankVoice(MAC_CHROME[1]), VOICE_UNUSABLE);
});

test("rankVoice: better voices score lower, tired SAPI voices score last", () => {
  const premiumAva = MAC_SAFARI[4];
  const aria = WINDOWS_WITH_NATURAL[2];
  const samantha = MAC_CHROME[2];
  const zira = WINDOWS_SAPI_ONLY[1];
  assert.ok(rankVoice(premiumAva) < rankVoice(aria));
  assert.ok(rankVoice(aria) < rankVoice(samantha));
  assert.ok(rankVoice(samantha) < rankVoice(zira));
  // A non-English voice is never a candidate, however good it sounds.
  assert.equal(rankVoice({ name: "Thomas", lang: "fr-FR" }), VOICE_UNUSABLE);
});

test("pickVoice: takes the best voice and the pacing that voice needs", () => {
  const safari = pickVoice(MAC_SAFARI);
  assert.ok(safari);
  assert.equal(safari.voice.name, "Ava");
  assert.equal(safari.rate, 0.7); // Apple voices run ~205 wpm at 1.0 — far too fast.
  assert.equal(safari.pitch, 1);
  assert.equal(safari.volume, 1);

  const natural = pickVoice(WINDOWS_WITH_NATURAL);
  assert.ok(natural);
  assert.match(natural.voice.name, /Aria/);
  assert.equal(natural.rate, 0.95); // Neural voices are already near conversational pace.
});

test("pickVoice: degrades to whatever is installed rather than going silent", () => {
  // The only en-US voices on many Windows boxes are the ones we like least.
  const windows = pickVoice(WINDOWS_SAPI_ONLY);
  assert.ok(windows);
  assert.match(windows.voice.name, /David|Zira/);

  // Chrome on a stock Mac: 24 of 28 en-US voices are novelties, so the one
  // sane voice has to be found by name, not by array position.
  const mac = pickVoice(MAC_CHROME);
  assert.ok(mac);
  assert.equal(mac.voice.name, "Samantha");

  // Android/Chromium report en_US with an underscore; that must not exclude it.
  const android = pickVoice([{ name: "English United States", lang: "en_US", localService: true }]);
  assert.ok(android);
  assert.equal(android.voice.lang, "en_US");

  // No en-US at all: an en-GB voice still beats saying nothing.
  const british = pickVoice([{ name: "Daniel", lang: "en-GB", localService: true }]);
  assert.ok(british);
  assert.equal(british.voice.name, "Daniel");
});

test("pickVoice: null when there is nothing worth speaking with", () => {
  assert.equal(pickVoice([]), null);
  assert.equal(pickVoice(MAC_SAFARI.slice(0, 3)), null); // novelties only
  assert.equal(pickVoice([{ name: "Thomas", lang: "fr-FR" }]), null);
});

// ── Chunking ──────────────────────────────────────────────────────────────

const GREETING =
  "Relocate here. Tell me where you're moving from, where to, and roughly " +
  "when — and your email, pets, kids or a car if you have them. All in one go is fine.";

// The orchestrator's dispatch closing, verbatim (main.py `_CLOSING`). This is
// the longest line the product speaks and the one most worth protecting.
const CLOSING =
  "On it. You'll get an email with a live tracking link in a minute — " +
  "there's a spot on that page to add your account numbers if you want " +
  "those cancelled too. Hang up whenever.";

test("chunkForSpeech: one utterance per sentence, so each gets its own cadence", () => {
  const chunks = chunkForSpeech(shapeForSpeech(GREETING));
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0], "Relocate here.");
  assert.match(chunks[2], /All in one go is fine\.$/);
});

test("chunkForSpeech: every chunk stays under the cap, and under the watchdog", () => {
  for (const source of [GREETING, CLOSING]) {
    const chunks = chunkForSpeech(shapeForSpeech(source));
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length > 0);
      assert.ok(chunk.length <= 160, `too long (${chunk.length}): ${chunk}`);
      // Chrome on Windows kills an utterance around 15 s. Nothing may come close.
      assert.ok(estimateSpeechMs(chunk, 0.7) < 12_000);
    }
  }
});

test("chunkForSpeech: round-trips the text, whatever the cap", () => {
  const shaped = shapeForSpeech(CLOSING);
  for (const cap of [40, 80, 160, 500]) {
    assert.equal(chunkForSpeech(shaped, cap).join(" "), shaped);
  }
  // Prose with no terminal punctuation at all still has to chunk cleanly.
  const runOn = "moving from san francisco to austin sometime in march with two cats and a car ".repeat(3).trim();
  const chunks = chunkForSpeech(runOn, 60);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(" "), runOn);
});

test("chunkForSpeech: never breaks inside an abbreviation or an email", () => {
  const abbrev = chunkForSpeech("Dr. Chen signed the lease. Ask e.g. about the deposit. We move Friday.", 30);
  for (const chunk of abbrev) {
    assert.ok(!/\b(Dr|e\.g|i\.e|Apt|St)\.$/.test(chunk), `split an abbreviation: ${chunk}`);
  }

  const withEmail = chunkForSpeech("Email me at sam.ortega@gmail.com. Then we go.", 30);
  for (const chunk of withEmail) {
    // Either the whole address is in this chunk, or none of it is.
    if (chunk.includes("@")) assert.match(chunk, /sam\.ortega@gmail\.com/);
  }

  // Once shaped, the spoken form of the address must survive as one piece too.
  const shaped = chunkForSpeech(shapeForSpeech("Confirming sam.ortega@gmail.com for the tracking link."), 60);
  assert.ok(shaped.some((c) => c.includes("sam dot ortega at gmail dot com")));
});

test("chunkForSpeech: nothing to say produces nothing to speak", () => {
  assert.deepEqual(chunkForSpeech(""), []);
  assert.deepEqual(chunkForSpeech("   \n  "), []);
});

// ── Speech shaping ────────────────────────────────────────────────────────

test("shapeForSpeech: reads back the details the concierge confirms", () => {
  assert.match(shapeForSpeech("Confirming sam.ortega@gmail.com."), /sam dot ortega at gmail dot com/);
  assert.match(shapeForSpeech("Move date 2026-03-15."), /March fifteenth, twenty twenty-six/);
  assert.match(shapeForSpeech("Moving 3/15/2026."), /March fifteenth, twenty twenty-six/);
  assert.match(shapeForSpeech("Call 512-555-0134."), /five one two, five five five, oh one three four/);
  assert.match(shapeForSpeech("From 1200 NW 5th Ave, Apt 3B."), /twelve hundred Northwest fifth Avenue, apartment three B/);
  assert.match(shapeForSpeech("Budget is $2,400."), /two thousand four hundred dollars/);
  assert.match(shapeForSpeech("Movers arrive 3:30pm."), /three thirty PM/);
  assert.match(shapeForSpeech("Ask the HOA."), /H O A/);
});

test("shapeForSpeech: a bracketed detail never leaves a comma sitting on the period", () => {
  // The email and phone rules pad their output with commas. An address at the
  // end of a sentence used to land as ",." — which the tired SAPI voices read
  // aloud as the word "comma". The concierge confirms an email on nearly every
  // dispatch turn, so this is the hot path, not an edge case.
  for (const said of [
    "Confirming sam.ortega@gmail.com.",
    "I'll send it to sam@x.co!",
    "Should I use sam@x.co?",
    "Call 512-555-0134.",
  ]) {
    assert.doesNotMatch(shapeForSpeech(said), /,\s*[.!?]/, said);
  }
  // The bracketing pause before the detail is still there.
  assert.match(shapeForSpeech("Confirming sam@x.co."), /Confirming, sam at x dot co\.$/);
});

test("shapeForSpeech: pauses come from punctuation, never from invented words", () => {
  // Engines disagree about the em dash; a comma is the pause every engine honours.
  assert.ok(!shapeForSpeech(GREETING).includes("—"));
  assert.match(shapeForSpeech(GREETING), /roughly when, and your email/);
  // An opener gets its breath.
  assert.match(shapeForSpeech("Got it moving on"), /^Got it, moving on/);
  // Every reply ends on a closing fall.
  assert.match(shapeForSpeech("no terminator here"), /\.$/);
  // No filler is ever added.
  assert.ok(!/\b(um|uh|let me see|hmm)\b/i.test(shapeForSpeech(GREETING)));
});

test("shapeForSpeech: strips formatting without eating the words", () => {
  const shaped = shapeForSpeech("**Origin** confirmed.\n- _Austin_ next\n- `deposit` due");
  assert.ok(!/[*_`]/.test(shaped));
  for (const word of ["Origin", "confirmed", "Austin", "next", "deposit", "due"]) {
    assert.ok(shaped.includes(word), `lost "${word}" from: ${shaped}`);
  }
});

test("shapeForSpeech: plain prose is left alone, empty stays empty", () => {
  assert.equal(shapeForSpeech("Where are you moving to?"), "Where are you moving to?");
  assert.equal(shapeForSpeech(""), "");
});

// ── Watchdog and error copy ───────────────────────────────────────────────

test("estimateSpeechMs: scales with length and inversely with rate", () => {
  assert.equal(estimateSpeechMs(""), 0);
  const slow = estimateSpeechMs(GREETING, 0.7);
  const fast = estimateSpeechMs(GREETING, 0.95);
  assert.ok(slow > fast);
  // The greeting is ~10-13 s as one utterance — right on Chrome's 15 s edge,
  // which is why it is spoken as three.
  assert.ok(slow > 9_000 && slow < 14_000, `greeting estimate was ${slow}ms`);
  // The watchdog must never fire before the utterance could plausibly finish.
  assert.ok(speechWatchdogMs(GREETING, 0.7) > slow * 2);
});

test("synthesisErrorMessage: honest about failure, silent about our own cancels", () => {
  // We cancel on every new turn, on mute and on teardown — that is not a failure.
  assert.equal(synthesisErrorMessage("interrupted"), "");
  assert.equal(synthesisErrorMessage("canceled"), "");
  assert.match(synthesisErrorMessage("network"), /cloud voice/);
  assert.match(synthesisErrorMessage("synthesis-failed"), /reply is above/);
  assert.match(synthesisErrorMessage("audio-busy"), /audio output/);
  assert.match(synthesisErrorMessage("weird-code"), /reply is above/);
});

test("turnFailureMessage: a dead backend is stated, not dressed up as a blip", () => {
  // 503 is the orchestrator saying every completion provider is down. Telling
  // the reader to try again would send them round a loop that cannot succeed.
  const down = turnFailureMessage(503);
  assert.match(down, /nothing was dispatched/);
  assert.match(down, /typed form/);
  assert.doesNotMatch(down, /again/);
  // Anything else may genuinely be transient.
  assert.equal(turnFailureMessage(null), "Couldn't reach the concierge just then. Try that again.");
});

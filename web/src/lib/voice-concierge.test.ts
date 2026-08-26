import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTurn,
  detectSpeechSupport,
  fieldLabel,
  missingCoreFields,
  missingSummary,
  parseConciergeEnd,
  parseConciergeTurn,
  recognitionErrorMessage,
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

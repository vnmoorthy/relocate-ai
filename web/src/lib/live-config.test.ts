import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStartMovePayload,
  isValidEmail,
  isValidMoveDate,
  parseLiveConfig,
  publicWsUrl,
  startMoveErrorMessage,
  startMoveUrl,
  validateStartMove,
  type StartMoveInput,
} from "./live-config.ts";

test("discovery payload is validated and normalized", () => {
  assert.equal(parseLiveConfig({ api: "https://relay.example.org" }), "https://relay.example.org");
  assert.equal(parseLiveConfig({ api: "https://relay.example.org/" }), "https://relay.example.org");
  assert.equal(parseLiveConfig({ api: " https://relay.example.org/v1// " }), "https://relay.example.org/v1");
  assert.equal(parseLiveConfig({ api: "https://Relay.Example.org:8443" }), "https://relay.example.org:8443");
});

test("discovery payload rejects anything that is not a clean https origin", () => {
  assert.equal(parseLiveConfig(null), null);
  assert.equal(parseLiveConfig("https://relay.example.org"), null);
  assert.equal(parseLiveConfig({}), null);
  assert.equal(parseLiveConfig({ api: 42 }), null);
  assert.equal(parseLiveConfig({ api: "" }), null);
  assert.equal(parseLiveConfig({ api: "http://relay.example.org" }), null);
  assert.equal(parseLiveConfig({ api: "ws://relay.example.org" }), null);
  assert.equal(parseLiveConfig({ api: "javascript:alert(1)" }), null);
  assert.equal(parseLiveConfig({ api: "relay.example.org" }), null);
  assert.equal(parseLiveConfig({ api: "https://user:pw@relay.example.org" }), null);
  assert.equal(parseLiveConfig({ api: "https://relay.example.org/?x=1" }), null);
  assert.equal(parseLiveConfig({ api: "https://relay.example.org/#frag" }), null);
});

test("public feed and intake URLs derive from the API origin", () => {
  assert.equal(publicWsUrl("https://relay.example.org"), "wss://relay.example.org/ws/public");
  assert.equal(publicWsUrl("https://relay.example.org/v1"), "wss://relay.example.org/v1/ws/public");
  assert.equal(startMoveUrl("https://relay.example.org"), "https://relay.example.org/api/public/start-move");
});

test("move-date validation accepts real calendar dates only", () => {
  assert.equal(isValidMoveDate("2026-09-15"), true);
  assert.equal(isValidMoveDate("2028-02-29"), true);
  assert.equal(isValidMoveDate("2027-02-29"), false);
  assert.equal(isValidMoveDate("2026-13-01"), false);
  assert.equal(isValidMoveDate("2026-00-10"), false);
  assert.equal(isValidMoveDate("2026-04-31"), false);
  assert.equal(isValidMoveDate("09/15/2026"), false);
  assert.equal(isValidMoveDate(""), false);
});

test("email validation is a permissive shape check", () => {
  assert.equal(isValidEmail("mover@example.com"), true);
  assert.equal(isValidEmail("first.last+tag@sub.example.co"), true);
  assert.equal(isValidEmail("mover@example"), false);
  assert.equal(isValidEmail("mover example.com"), false);
  assert.equal(isValidEmail("@example.com"), false);
});

const validInput: StartMoveInput = {
  origin: " 12 Harbor St, Boston, MA ",
  destination: "88 Pine Ave, Austin, TX",
  moveDate: "2026-10-01",
  email: "mover@example.com",
  hasPets: true,
  hasChildren: false,
  hasCar: true,
  hasVisa: false,
};

test("form validation reports every missing or malformed field", () => {
  assert.deepEqual(validateStartMove(validInput), {});
  const errors = validateStartMove({
    ...validInput,
    origin: "   ",
    destination: "",
    moveDate: "2026-02-30",
    email: "nope",
  });
  assert.deepEqual(Object.keys(errors).sort(), ["destination", "email", "moveDate", "origin"]);
  assert.deepEqual(Object.keys(validateStartMove({ ...validInput, moveDate: "", email: "" })).sort(), [
    "email",
    "moveDate",
  ]);
});

test("intake payload matches the backend contract and always carries the honeypot", () => {
  assert.deepEqual(buildStartMovePayload(validInput), {
    origin_address: "12 Harbor St, Boston, MA",
    destination_address: "88 Pine Ave, Austin, TX",
    move_date: "2026-10-01",
    user_email: "mover@example.com",
    has_pets: true,
    has_children: false,
    has_car: true,
    has_visa: false,
    website: "",
  });
  assert.equal(buildStartMovePayload(validInput, "http://spam").website, "http://spam");
});

test("intake errors map to plain language", () => {
  assert.match(startMoveErrorMessage(429, null), /Too many/);
  assert.match(startMoveErrorMessage(503, { detail: "disabled" }), /paused/);
  assert.equal(startMoveErrorMessage(400, { detail: "move_date must be in the future" }), "move_date must be in the future");
  assert.match(startMoveErrorMessage(400, {}), /rejected/);
  assert.equal(
    startMoveErrorMessage(422, { detail: [{ loc: ["body", "user_email"], msg: "value is not a valid email", type: "x" }] }),
    "value is not a valid email",
  );
  assert.match(startMoveErrorMessage(500, { detail: "stack trace here" }), /on its side/);
  assert.match(startMoveErrorMessage(418, null), /HTTP 418/);
  assert.ok(startMoveErrorMessage(400, { detail: "x".repeat(1000) }).length <= 240);
});

"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  buildStartMovePayload,
  isValidEmail,
  startMoveErrorMessage,
  startMoveUrl,
  validateStartMove,
  type StartMoveErrors,
  type StartMoveField,
  type StartMoveInput,
} from "@/lib/live-config";

interface Props {
  /** Live API origin from discovery (https, no trailing slash). */
  api: string;
  /** Called with the dispatcher's event id once the move is accepted. */
  onStarted?: (eventId: string) => void;
}

// The shareable tracking page is a static route; the move id rides in the
// URL hash so the link survives static hosting under the basePath.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Status =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; eventId: string }
  | { kind: "error"; message: string };

/** Optional detail is held as "" (never undefined) so inputs stay controlled. */
type HouseholdField =
  | "userName"
  | "userPhone"
  | "childName"
  | "childGrade"
  | "petName"
  | "petSpecies"
  | "vetEmail";

type FormState = StartMoveInput & Record<HouseholdField, string>;

const EMPTY: FormState = {
  origin: "",
  destination: "",
  moveDate: "",
  email: "",
  hasPets: false,
  hasChildren: false,
  hasCar: false,
  hasVisa: false,
  userName: "",
  userPhone: "",
  childName: "",
  childGrade: "",
  petName: "",
  petSpecies: "",
  vetEmail: "",
};

const TOGGLES: Array<{ key: "hasPets" | "hasChildren" | "hasCar" | "hasVisa"; label: string }> = [
  { key: "hasPets", label: "Pets" },
  { key: "hasChildren", label: "Kids" },
  { key: "hasCar", label: "Car" },
  { key: "hasVisa", label: "Visa" },
];

const FIELD_ORDER: StartMoveField[] = ["origin", "destination", "moveDate", "email"];

// Same sentence under every conditional block: it says why the extra typing is
// worth it without promising anything.
const SUB_HINT = "Optional — supplying this lets that specialist actually file the request.";

/**
 * Web intake for a REAL dispatch. Rendered only when a live backend has been
 * discovered — there is no simulated submit path. POSTs the contract payload
 * to /api/public/start-move and reports the outcome inline.
 *
 * The four required fields brief the dispatcher; the optional household detail
 * (revealed by the Kids / Pets toggles) is what lets the school and vet
 * specialists file a real request instead of handing back to the human.
 */
export function StartMove({ api, onStarted }: Props) {
  const uid = useId();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<StartMoveErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [vetEmailTouched, setVetEmailTouched] = useState(false);
  const honeypotRef = useRef<HTMLInputElement | null>(null);
  const fieldRefs = useRef<Partial<Record<StartMoveField, HTMLInputElement | null>>>({});

  const pending = status.kind === "pending";

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key in errors) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key as StartMoveField];
        return next;
      });
    }
  };

  // Advisory only — a malformed vet email never blocks the dispatch, it is
  // simply dropped server-side. Held back until the field has been left once.
  const vetEmailLooksWrong =
    form.hasPets &&
    vetEmailTouched &&
    form.vetEmail.trim() !== "" &&
    !isValidEmail(form.vetEmail);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validateStartMove(form);
    setErrors(nextErrors);
    const firstInvalid = FIELD_ORDER.find((field) => field in nextErrors);
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
      setStatus({ kind: "idle" });
      return;
    }

    setStatus({ kind: "pending" });
    try {
      const res = await fetch(startMoveUrl(api), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildStartMovePayload(form, honeypotRef.current?.value ?? "")),
      });
      const body = await readJson(res);
      if (res.ok) {
        const eventId =
          typeof body === "object" && body !== null && typeof (body as { event_id?: unknown }).event_id === "string"
            ? (body as { event_id: string }).event_id
            : "";
        if (!eventId) {
          setStatus({
            kind: "error",
            message: "The dispatcher answered without a move reference. Try again in a moment.",
          });
          return;
        }
        setStatus({ kind: "ok", eventId });
        onStarted?.(eventId);
        return;
      }
      setStatus({ kind: "error", message: startMoveErrorMessage(res.status, body) });
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't reach the dispatcher. Check your connection and try again.",
      });
    }
  }

  const fieldId = (field: string) => `${uid}-${field}`;
  const errorId = (field: string) => `${uid}-${field}-error`;

  return (
    <form className="start-move" onSubmit={onSubmit} noValidate>
      <p className="start-move-lead">
        Brief the dispatcher by form instead of by phone. It fans out the same
        swarm you see below.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
        <TextField
          id={fieldId("origin")}
          label="From"
          name="origin_address"
          placeholder="Street, city, state"
          value={form.origin}
          error={errors.origin}
          errorId={errorId("origin")}
          disabled={pending}
          required
          inputRef={(el) => { fieldRefs.current.origin = el; }}
          onChange={(value) => setField("origin", value)}
        />
        <TextField
          id={fieldId("destination")}
          label="To"
          name="destination_address"
          placeholder="Street, city, state"
          value={form.destination}
          error={errors.destination}
          errorId={errorId("destination")}
          disabled={pending}
          required
          inputRef={(el) => { fieldRefs.current.destination = el; }}
          onChange={(value) => setField("destination", value)}
        />
        <TextField
          id={fieldId("date")}
          label="Move date"
          name="move_date"
          type="date"
          value={form.moveDate}
          error={errors.moveDate}
          errorId={errorId("date")}
          disabled={pending}
          required
          inputRef={(el) => { fieldRefs.current.moveDate = el; }}
          onChange={(value) => setField("moveDate", value)}
        />
        <TextField
          id={fieldId("email")}
          label="Email"
          name="user_email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={form.email}
          error={errors.email}
          errorId={errorId("email")}
          disabled={pending}
          required
          inputRef={(el) => { fieldRefs.current.email = el; }}
          onChange={(value) => setField("email", value)}
        />
        <TextField
          id={fieldId("name")}
          label="Your name"
          name="user_name"
          autoComplete="name"
          placeholder="Optional"
          value={form.userName}
          disabled={pending}
          onChange={(value) => setField("userName", value)}
        />
        <TextField
          id={fieldId("phone")}
          label="Phone (for your concierge callback)"
          name="user_phone"
          type="tel"
          autoComplete="tel"
          placeholder="Optional"
          value={form.userPhone}
          disabled={pending}
          onChange={(value) => setField("userPhone", value)}
        />
      </div>

      <fieldset className="start-move-toggles" disabled={pending}>
        <legend className="sm-label">Household</legend>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {TOGGLES.map(({ key, label }) => (
            <label key={key} className="sm-check" htmlFor={fieldId(key)}>
              <input
                id={fieldId(key)}
                type="checkbox"
                name={key}
                checked={form[key]}
                onChange={(event) => setField(key, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Kids → the school-enrollment specialist. Nothing here is required and
          nothing here is sent while the Kids box is unchecked. */}
      <Reveal open={form.hasChildren}>
        <fieldset className="sm-sub">
          <legend className="sm-label">For the school agent</legend>
          <p className="sm-sub-hint">{SUB_HINT}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <TextField
              id={fieldId("child-name")}
              label="Child's name"
              name="child_name"
              placeholder="First name"
              value={form.childName}
              disabled={pending}
              onChange={(value) => setField("childName", value)}
            />
            <TextField
              id={fieldId("child-grade")}
              label="Grade"
              name="child_grade"
              placeholder="4th"
              value={form.childGrade}
              disabled={pending}
              onChange={(value) => setField("childGrade", value)}
            />
          </div>
        </fieldset>
      </Reveal>

      {/* Pets → the vet-records specialist. Same rules. */}
      <Reveal open={form.hasPets}>
        <fieldset className="sm-sub">
          <legend className="sm-label">For the vet agent</legend>
          <p className="sm-sub-hint">{SUB_HINT}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <TextField
              id={fieldId("pet-name")}
              label="Pet's name"
              name="pet_name"
              placeholder="Biscuit"
              value={form.petName}
              disabled={pending}
              onChange={(value) => setField("petName", value)}
            />
            <TextField
              id={fieldId("pet-species")}
              label="Species"
              name="pet_species"
              placeholder="dog"
              value={form.petSpecies}
              disabled={pending}
              onChange={(value) => setField("petSpecies", value)}
            />
            <TextField
              id={fieldId("vet-email")}
              label="Current vet's email"
              name="vet_email"
              type="email"
              placeholder="clinic@example.com"
              value={form.vetEmail}
              warning={
                vetEmailLooksWrong
                  ? "That doesn't look like an email — it'll be dropped, everything else still goes."
                  : undefined
              }
              disabled={pending}
              onChange={(value) => setField("vetEmail", value)}
              onBlur={() => setVetEmailTouched(true)}
            />
          </div>
        </fieldset>
      </Reveal>

      {/* Honeypot: offscreen (never display:none), unfocusable, no autofill.
          Humans leave it blank; the server rejects anything else. */}
      <div className="hp-field" aria-hidden="true">
        <label htmlFor={fieldId("website")}>Website</label>
        <input
          ref={honeypotRef}
          id={fieldId("website")}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="submit"
          className="btn-solid w-full"
          disabled={pending}
          aria-busy={pending}
          aria-describedby={`${uid}-note`}
        >
          {pending ? "Dispatching…" : "Start the dispatch"}
        </button>
        <p
          className={`sm-status ${status.kind === "error" ? "sm-status--error" : ""} ${status.kind === "ok" ? "sm-status--ok" : ""}`}
          role="status"
          aria-live="polite"
        >
          {status.kind === "pending" && "Dispatching…"}
          {status.kind === "ok" && (
            <>
              Dispatched · watch the swarm go live
              <span className="sm-ref">ref {status.eventId}</span>
              <span className="block mt-2">
                <a
                  className="arrow-link"
                  href={`${BASE_PATH}/move/#${encodeURIComponent(status.eventId)}`}
                >
                  Open your move page →
                </a>
              </span>
            </>
          )}
          {status.kind === "error" && status.message}
        </p>
        <p id={`${uid}-note`} className="sm-note">
          Live · this starts a real dispatch. Specialists that can&rsquo;t finish
          hand back to you.
        </p>
      </div>
    </form>
  );
}

/**
 * Height-animated disclosure. The block stays mounted so its height can be
 * transitioned (0fr → 1fr) instead of snapping the page, and is `inert` while
 * closed so it takes no tab stops and no screen-reader attention.
 */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`sm-reveal${open ? " sm-reveal--open" : ""}`} inert={!open}>
      <div className="sm-reveal-inner">{children}</div>
    </div>
  );
}

function TextField({
  id,
  label,
  name,
  type = "text",
  value,
  placeholder,
  autoComplete,
  error,
  errorId,
  warning,
  disabled,
  required,
  inputRef,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  name: string;
  type?: "text" | "date" | "email" | "tel";
  value: string;
  placeholder?: string;
  autoComplete?: string;
  /** Blocking: submit already stopped for this field. */
  error?: string;
  errorId?: string;
  /** Advisory: shown, but the value is still submitted (server drops it). */
  warning?: string;
  disabled: boolean;
  required?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const warningId = `${id}-warning`;
  const describedBy = error && errorId ? errorId : warning ? warningId : undefined;
  return (
    <div className="sm-field">
      <label htmlFor={id} className="sm-label">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        className="sm-input"
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error && errorId && (
        <span id={errorId} className="sm-error">
          {error}
        </span>
      )}
      {!error && warning && (
        <span id={warningId} className="sm-warn">
          {warning}
        </span>
      )}
    </div>
  );
}

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

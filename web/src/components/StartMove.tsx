"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  buildStartMovePayload,
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

type Status =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "ok"; eventId: string }
  | { kind: "error"; message: string };

const EMPTY: StartMoveInput = {
  origin: "",
  destination: "",
  moveDate: "",
  email: "",
  hasPets: false,
  hasChildren: false,
  hasCar: false,
  hasVisa: false,
};

const TOGGLES: Array<{ key: "hasPets" | "hasChildren" | "hasCar" | "hasVisa"; label: string }> = [
  { key: "hasPets", label: "Pets" },
  { key: "hasChildren", label: "Kids" },
  { key: "hasCar", label: "Car" },
  { key: "hasVisa", label: "Visa" },
];

const FIELD_ORDER: StartMoveField[] = ["origin", "destination", "moveDate", "email"];

/**
 * Web intake for a REAL dispatch. Rendered only when a live backend has been
 * discovered — there is no simulated submit path. POSTs the contract payload
 * to /api/public/start-move and reports the outcome inline.
 */
export function StartMove({ api, onStarted }: Props) {
  const uid = useId();
  const [form, setForm] = useState<StartMoveInput>(EMPTY);
  const [errors, setErrors] = useState<StartMoveErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const honeypotRef = useRef<HTMLInputElement | null>(null);
  const fieldRefs = useRef<Partial<Record<StartMoveField, HTMLInputElement | null>>>({});

  const pending = status.kind === "pending";

  const setField = <K extends keyof StartMoveInput>(key: K, value: StartMoveInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key in errors) {
      setErrors((current) => {
        const next = { ...current };
        delete next[key as StartMoveField];
        return next;
      });
    }
  };

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
          inputRef={(el) => { fieldRefs.current.email = el; }}
          onChange={(value) => setField("email", value)}
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
  disabled,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  name: string;
  type?: "text" | "date" | "email";
  value: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  errorId: string;
  disabled: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
}) {
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
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <span id={errorId} className="sm-error">
          {error}
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

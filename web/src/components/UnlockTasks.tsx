"use client";

import { useState, type FormEvent } from "react";
import {
  ASKABLE_FIELDS,
  askableFieldsFor,
  moveDetailsUrl,
  type MoveTaskView,
} from "@/lib/move-page";

/**
 * Hand the swarm the account numbers a spoken call never asks for.
 *
 * Reading a long account identifier aloud is error-prone, so the concierge
 * deliberately does not ask during a call — which leaves real work undone.
 * This is where those numbers arrive, typed and exact; the specialists
 * waiting on them start immediately, without the customer doing the task.
 *
 * Only ever offered for tasks blocked on a missing field. A signature or a
 * portal login cannot be fixed by a text box, and pretending otherwise would
 * be the kind of overclaim this product exists to avoid.
 */

export interface UnlockTasksProps {
  api: string;
  eventId: string;
  tasks: MoveTaskView[];
  /** Called after the server accepts, so the page can refresh its snapshot. */
  onUnlocked: () => void;
}

export function UnlockTasks({ api, eventId, tasks, onUnlocked }: UnlockTasksProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Ask for exactly what these tasks are waiting on — a Comcast cancellation
  // needs the account holder's name as well as the account number, and a
  // spoken call often captured neither.
  const fields = askableFieldsFor(tasks);
  if (tasks.length === 0 || fields.length === 0 || done) return null;

  const filled = fields.filter((name) => (values[name] ?? "").trim());

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || filled.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { authorize_providers: true };
      for (const name of filled) {
        body[name] = (values[name] ?? "").trim();
      }
      const res = await fetch(moveDetailsUrl(api, eventId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`details http ${res.status}`);
      setDone(true);
      onUnlocked();
    } catch {
      setError("Couldn't save those just now. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="mv-unlock-heading" className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="mv-unlock-heading" className="kicker">Let the swarm finish these</h2>
        <span className="tm-label text-[var(--brand)] shrink-0">
          {tasks.length} can run
        </span>
      </div>
      <form className="mv-unlock" onSubmit={onSubmit}>
        <p className="mv-unlock-lead">
          These are waiting on an account number — the one thing a spoken call
          shouldn&rsquo;t ask you to read out. Add them and Relocate sends the
          cancellations itself, on your behalf. Never asks for passwords.
        </p>
        <div className="mv-unlock-grid">
          {fields.map((name) => {
            const field = ASKABLE_FIELDS[name];
            return (
              <label key={name} className="mv-unlock-field">
                <span className="sm-label">{field.label}</span>
                <input
                  type="text"
                  name={name}
                  value={values[name] ?? ""}
                  placeholder={field.hint}
                  disabled={pending}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                />
              </label>
            );
          })}
        </div>
        {error && <p className="mv-unlock-error" role="status">{error}</p>}
        <button type="submit" className="btn-solid mv-unlock-go" disabled={pending || filled.length === 0}>
          {pending
            ? "Sending…"
            : filled.length === 0
              ? "Add an account number"
              : `Authorize & send ${filled.length}`}
        </button>
      </form>
    </section>
  );
}

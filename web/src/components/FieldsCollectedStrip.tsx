"use client";

interface Props {
  collectedFields: Record<string, string | number | boolean>;
}

/**
 * Compact strip rendered above the swarm. Each pill = a field the buyer has
 * captured this call. Lit pills (mint) are core; dim pills (ink-500) are
 * optional / PII-gated.
 *
 * The list of fields here mirrors orchestrator/app/buyer_schema.py — if the
 * schema grows, add the field name to one of the constant arrays below.
 */
const CORE_FIELDS = [
  "origin_address",
  "destination_address",
  "move_date",
  "user_email",
] as const;

const CONDITIONAL_FIELDS = [
  "has_pets",
  "has_children",
  "has_car",
  "has_visa",
] as const;

const OPTIONAL_FIELDS = [
  "user_name",
  "household_size",
  "pet_name",
  "pet_species",
  "vet_email",
  "child_name",
  "child_grade",
  "child_previous_school",
  "bank_name",
  "origin_airport",
  "destination_airport",
] as const;

const LABEL: Record<string, string> = {
  origin_address: "from",
  destination_address: "to",
  move_date: "date",
  user_email: "email",
  has_pets: "pets?",
  has_children: "kids?",
  has_car: "car?",
  has_visa: "visa?",
  user_name: "name",
  household_size: "size",
  pet_name: "pet",
  pet_species: "species",
  vet_email: "vet",
  child_name: "child",
  child_grade: "grade",
  child_previous_school: "school",
  bank_name: "bank",
  origin_airport: "from-air",
  destination_airport: "to-air",
};

export function FieldsCollectedStrip({ collectedFields }: Props) {
  const allFields = [...CORE_FIELDS, ...CONDITIONAL_FIELDS, ...OPTIONAL_FIELDS];
  // Count only what actually gates dispatch. The optional pills are nice to
  // have and are mostly collected later by email, so folding them into the
  // denominator made a finished intake read "8/19" — a complete call looking
  // two-thirds done, at the moment the caller is being told it worked.
  const gating = [...CORE_FIELDS, ...CONDITIONAL_FIELDS];
  const gatingDone = gating.filter((field) => field in collectedFields);
  const extras = OPTIONAL_FIELDS.filter((field) => field in collectedFields);
  const coreDone = CORE_FIELDS.every((f) => f in collectedFields);

  return (
    <section className="panel px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-clean scroll-fade-r" aria-labelledby="fields-heading">
      <h3 id="fields-heading" className="text-[10px] tracking-[0.12em] text-[var(--ink-300)] uppercase shrink-0 pr-2 border-r border-[var(--border-soft)]">
        Buyer · {gatingDone.length}/{gating.length} fields
        {extras.length > 0 && <span className="text-[var(--ink-400)] ml-1">{" "}+{extras.length}</span>}
        {coreDone && <span className="text-[var(--mint)] ml-1.5">· dispatch ready</span>}
      </h3>
      <div className="flex items-center gap-2" role="list" aria-live="polite">
      {allFields.map((f) => {
        const have = f in collectedFields;
        const isCore = (CORE_FIELDS as readonly string[]).includes(f);
        const isCondi = (CONDITIONAL_FIELDS as readonly string[]).includes(f);
        return (
          <div
            key={f}
            role="listitem"
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded border shrink-0 ${
              have
                ? "bg-[rgba(0,212,154,0.06)] border-[rgba(0,212,154,0.30)]"
                : "bg-[var(--bg-elev)] border-[var(--border-soft)]"
            }`}
            title={have ? `${f} collected; value hidden on public dashboard` : `${f} not collected`}
            aria-label={`${LABEL[f] ?? f}: ${have ? "collected, value hidden" : "not collected"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                have
                  ? isCore
                    ? "bg-[var(--mint)]"
                    : isCondi
                      ? "bg-[var(--cyan)]"
                      : "bg-[var(--amber)]"
                  : "bg-[var(--ink-700)]"
              }`}
            />
            <span
              className={`text-[10px] font-mono-tight ${
                have ? "text-[var(--ink-100)]" : "text-[var(--ink-500)]"
              }`}
            >
              {LABEL[f] ?? f}
            </span>
          </div>
        );
      })}
      </div>
    </section>
  );
}

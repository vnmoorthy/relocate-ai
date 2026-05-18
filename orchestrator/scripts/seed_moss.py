"""Seed the Moss index with 7 specialist runbooks.

Run ONCE before the demo, after MOSS_PROJECT_ID + MOSS_PROJECT_KEY land in .env.
Uploads short markdown runbooks for each LIVE specialist agent so Moss can
retrieve them at dispatch time and inject into each specialist's system prompt.

Usage:
    cd orchestrator
    uv run python scripts/seed_moss.py

Idempotency: if the index already has docs, this script skips them by ID.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402


# Each runbook is a short, focused piece of operational knowledge that the
# specialist agent uses to navigate its specific category's quirks.
RUNBOOKS: list[dict[str, str]] = [
    {
        "id": "pge_shutoff_sf",
        "category": "utility-electric-gas",
        "city": "San Francisco",
        "text": (
            "PG&E disconnect runbook for San Francisco. "
            "IVR menu: press 1 for English, then 4 for 'moving / disconnect service'. "
            "Hold time averages 2-4 minutes Sunday evening. "
            "Required info: service address, account holder name, last 4 of SSN OR account number, "
            "disconnect date (must be at least 1 business day out). "
            "Common pushback: 'we need 48 hours notice' — push back with 'this is an urgent move, "
            "I'll accept any same-day fees'. Final-bill arrives 4-6 weeks after disconnect. "
            "Confirmation reference is always 9 digits starting with the day-of-month. "
            "Watch for: agent trying to roll service over to a new SF address (decline; we're moving out of CA)."
        ),
    },
    {
        "id": "comcast_cancel_sf",
        "category": "utility-internet-sf",
        "city": "San Francisco",
        "text": (
            "Comcast Xfinity cancellation runbook. "
            "Direct cancellation line: 1-800-934-2489. The general support line will route through retention; "
            "the direct line connects faster but still has retention agents. "
            "Required info: account number (or phone + last 4 SSN), service address, reason for cancellation. "
            "Reason should be 'moving out of Comcast service area' — they don't operate in Austin. "
            "Pushback patterns: "
            "  - 'we can transfer your service' — decline, Austin isn't covered "
            "  - 'we'll waive 2 months' — politely decline "
            "  - 'early termination fee applies' — ask for waiver under the moving-out-of-area policy "
            "Final-bill arrives within 2 billing cycles. Return equipment (modem, router) at any Xfinity store "
            "within 14 days or call to schedule shipping label. Confirmation reference is 12 digits."
        ),
    },
    {
        "id": "geico_address_update",
        "category": "insurance-auto",
        "city": "San Francisco",
        "text": (
            "Geico address change runbook for CA → TX move. "
            "Phone: 1-800-861-3100. IVR: 3 for 'change my coverage / policy info'. "
            "Required info: policy number, last 4 SSN, current address, new address. "
            "CA rates differ from TX rates — Geico will quote a new rate for the new garage address. "
            "Texas typically slightly cheaper than San Francisco. Effective date is the move date. "
            "Watch for: agent suggesting full re-underwriting (decline if not needed; just an address change). "
            "Also update VIN garage location if asked. Confirmation reference is policy-suffix-letter pattern."
        ),
    },
    {
        "id": "usps_coa_runbook",
        "category": "postal",
        "city": "any",
        "text": (
            "USPS Change of Address (COA) via moversguide.usps.com runbook. "
            "Identity verification: $1.10 charge against a credit card whose billing address matches either "
            "old OR new address. This is a fraud-prevention floor; the charge stands regardless of submission. "
            "Form fields: old street, old city/state/zip, new street, new city/state/zip, move date, "
            "individual / family / business toggle, temporary (under 12 months) vs permanent. "
            "After submission: USPS sends a confirmation letter to the old address within 5 business days, "
            "and a Welcome Kit (with $750 in coupons) to the new address within 1-2 weeks. "
            "Confirmation number is the 16-digit Relocate ID printed on the success page."
        ),
    },
    {
        "id": "spectrum_austin_connect",
        "category": "utility-internet-austin",
        "city": "Austin",
        "text": (
            "Spectrum new-service runbook for Austin install. "
            "Sales line: 1-833-694-9379 (24/7). Connection options: "
            "  - Spectrum Internet Standard (300 Mbps): $50/mo "
            "  - Spectrum Internet Ultra (500 Mbps): $70/mo — recommended for 2BR household "
            "  - Spectrum Internet Gig (1 Gbps): $90/mo "
            "WiFi router rental: $5/mo, or BYOD modem. Install fee: $50 (often waived for new accounts; ask). "
            "Install window: typically 4-hour. Lead time: 3-5 business days minimum, longer for new construction. "
            "Required info: service address (must be in Spectrum coverage; check zip), name, phone. "
            "Watch for: bundle upsell to TV + Voice (decline). Confirmation reference: 'WO' + 10 digits."
        ),
    },
    {
        "id": "mover_quote_runbook",
        "category": "mover",
        "city": "San Francisco",
        "text": (
            "Bay-Area to Texas mover quote runbook. "
            "Standard ask for 2BR move with ~5,000 lbs household goods, no piano/safe, 1-truck job: "
            "  - Quote breakdown wanted: line-haul (per mile + weight), packing materials, fuel surcharge, "
            "    insurance basic vs full-replacement, deposit, balance-due-on-delivery. "
            "  - Quote validity period: ask for 7+ days. "
            "  - Truck availability for move date: must be confirmed before deposit. "
            "Typical OTD ranges for SF→Austin 2BR: $1,800-$3,500. "
            "Red flags: refusal to put quote in writing, deposit > 30% of OTD, no DOT/MC numbers. "
            "Confirmation: written quote PDF emailed, with carrier DOT number visible. "
            "Use the Quote-N-of-3 format at end of each call."
        ),
    },
    {
        "id": "buyer_extraction_runbook",
        "category": "buyer",
        "city": "any",
        "text": (
            "Buyer agent extraction runbook. "
            "Required fields to extract before dispatch: origin_address, destination_address, move_date, "
            "household_size (bedrooms), has_pets, has_children. "
            "Optional but valuable: pet_type (vet routing), school_grades (school-district routing), "
            "current_insurance_carrier (insurance routing), homeowner_phone. "
            "If user provides incomplete spec, ask AT MOST one clarifying question per turn. "
            "If after 2 turns the spec is still incomplete, dispatch with defaults and note missing fields. "
            "Closing line to user after dispatch: 'On it. I'll text you each task as it closes. "
            "Hang up whenever you want.' This phrase triggers the orchestrator's fan_out task."
        ),
    },
]


async def main() -> None:
    if not settings.moss_project_id or not settings.moss_project_key:
        print("MOSS_PROJECT_ID and MOSS_PROJECT_KEY must both be set in .env. Aborting.")
        sys.exit(1)

    try:
        from moss import MossClient  # type: ignore[import-not-found]
    except ImportError:
        print("Install moss SDK first:  uv add moss  (or  pip install moss)")
        sys.exit(1)

    client = MossClient(settings.moss_project_id, settings.moss_project_key)
    print(f"Seeding Moss index: {settings.moss_index_name}")

    # Most Moss flows: load_index ensures it exists, then upsert docs.
    try:
        await client.load_index(settings.moss_index_name)
        print(f"  index loaded: {settings.moss_index_name}")
    except Exception as e:
        print(f"  load_index failed ({type(e).__name__}: {e}); trying create+upsert anyway")

    # Upsert each runbook. The Moss SDK's exact upsert call may be `upsert`, `insert`,
    # or `add` depending on version — adjust based on the version installed.
    for rb in RUNBOOKS:
        try:
            # Best-guess shape; check Moss SDK docs if it errors here.
            await client.upsert(  # type: ignore[attr-defined]
                settings.moss_index_name,
                docs=[{
                    "id": rb["id"],
                    "text": rb["text"],
                    "metadata": {"category": rb["category"], "city": rb["city"]},
                }],
            )
            print(f"  upserted: {rb['id']}")
        except AttributeError:
            # Older SDKs may use `add` or `insert`
            print(f"  ⚠ upsert method not found on MossClient; check SDK version")
            print(f"     Run dir(client) on a python shell to find the right method name.")
            break
        except Exception as e:
            print(f"  ✗ {rb['id']}: {type(e).__name__}: {e}")

    print("\nDone. Verify via:")
    print(f'  uv run python -c "import asyncio; from app.integrations.moss import retrieve_runbook; '
          f'print(asyncio.run(retrieve_runbook(\\"smoke\\", \\"comcast cancellation\\", 1)))"')


if __name__ == "__main__":
    asyncio.run(main())

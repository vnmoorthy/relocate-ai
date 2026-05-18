"""Browser Use — real web automation for 5 shipping agents.

Phase 2: every agent here is a SHIPPING agent. No stub fall-through.
If BROWSER_USE_API_KEY is missing, the integration raises so the e2e test
fails loudly and the affected agents get removed from the roster.

Browser Use REST shape (per docs.browser-use.com/cloud-api/v1):
  POST /api/v1/run-task    — kicks off a headless run with a natural-language task
  GET  /api/v1/task/{id}   — polls status; returns extracted output on done

Each helper here builds a precise task description, ships it to Browser Use,
polls until done (or fails), and returns a dict of extracted artifacts.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from ..config import settings
from ._common import emit_sponsor_event


log = logging.getLogger(__name__)


BROWSERUSE_BASE = "https://api.browser-use.com/api/v1"
DEFAULT_POLL_INTERVAL = 4.0
DEFAULT_TIMEOUT_S = 300.0  # 5 minutes per task (Browser Use runs are typically 1–3 min)


def _has_key() -> bool:
    return bool(settings.browseruse_api_key) and settings.browseruse_api_key != "REPLACE_ME"


def _require_key(agent_id: str) -> None:
    if not _has_key():
        raise RuntimeError(
            f"BROWSER_USE_API_KEY missing — shipping agent {agent_id} cannot run. "
            "Set the key or remove this agent from PERSONAS."
        )


async def _run_task(
    *,
    event_id: str,
    agent_id: str,
    task_description: str,
    expected_keys: list[str],
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_steps: int = 40,
) -> dict[str, Any]:
    """Submit a Browser Use task and poll to completion.

    Returns the dict of extracted artifacts (the keys Browser Use returns
    in the structured output). Raises on timeout or failure — no silent stubs.
    """
    _require_key(agent_id)
    await emit_sponsor_event(
        event_id=event_id, sponsor="browser_use",
        action=f"started[{agent_id}]", detail=task_description[:160],
    )

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"Authorization": f"Bearer {settings.browseruse_api_key}"},
    ) as c:
        # Kick off the run.
        r = await c.post(
            f"{BROWSERUSE_BASE}/run-task",
            json={
                "task": task_description,
                "max_steps": max_steps,
                "metadata": {"event_id": event_id, "agent_id": agent_id},
                "structured_output_keys": expected_keys,
            },
        )
        r.raise_for_status()
        task_id = r.json().get("id")
        if not task_id:
            raise RuntimeError(f"Browser Use did not return a task id for {agent_id}")

        await emit_sponsor_event(
            event_id=event_id, sponsor="browser_use",
            action=f"task_id[{agent_id}]", detail=task_id,
        )

        # Poll to completion.
        elapsed = 0.0
        while elapsed < timeout_s:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            r = await c.get(f"{BROWSERUSE_BASE}/task/{task_id}")
            r.raise_for_status()
            data = r.json()
            status = data.get("status", "running")
            if status == "finished":
                output = data.get("output") or data.get("structured_output") or {}
                # Validate every expected key is present.
                missing = [k for k in expected_keys if k not in output]
                if missing:
                    raise RuntimeError(
                        f"Browser Use task {task_id} for {agent_id} finished "
                        f"but missing keys: {missing}. Got: {list(output.keys())}"
                    )
                await emit_sponsor_event(
                    event_id=event_id, sponsor="browser_use",
                    action=f"done[{agent_id}]", detail=str(output)[:160],
                )
                return {"task_id": task_id, **output}
            if status in ("failed", "stopped", "error"):
                err = data.get("error") or data.get("output") or "unknown"
                raise RuntimeError(
                    f"Browser Use task {task_id} for {agent_id} ended {status}: {err}"
                )
            # else still running — keep polling

    raise TimeoutError(
        f"Browser Use task {task_id} for {agent_id} did not finish in {timeout_s}s"
    )


# ──────────────────────────────────────────────────────────────────────
# Per-agent helpers (the 5 browser-mode shipping agents)
# ──────────────────────────────────────────────────────────────────────


async def submit_pge_shutoff(*, event_id: str, spec: dict) -> dict:
    """Agent #2 — PG&E disconnect via pge.com/movingcenter."""
    origin = spec.get("origin_address", "")
    move_date = spec.get("move_date", "")
    account = spec.get("pge_account_number", "")
    last4 = spec.get("pge_last4_ssn", "")
    task = (
        "Go to https://www.pge.com/en_US/residential/your-account/account-management/"
        "move-services/move-services.page and click 'Stop Service'. "
        f"Enter PG&E account number {account}, service address {origin}, "
        f"requested disconnect date {move_date}, and last 4 of SSN {last4}. "
        "Submit. On the confirmation page, capture the confirmation number, "
        "the scheduled disconnect date, and the final-bill ETA."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="pge_shutoff",
        task_description=task,
        expected_keys=["confirmation_number", "disconnect_date", "final_bill_eta"],
    )


async def submit_geico_address(*, event_id: str, spec: dict) -> dict:
    """Agent #4 — Geico address change via geico.com/service."""
    dest = spec.get("destination_address", "")
    move_date = spec.get("move_date", "")
    email = spec.get("geico_email", "")
    pwd = spec.get("geico_password", "")
    task = (
        "Go to https://www.geico.com/service/address-change/ and sign in with "
        f"email {email} and password {pwd}. Update mailing and garaging "
        f"address to {dest}, effective {move_date}. Submit. On the confirmation "
        "page capture the reference number and (if rate changed) the new "
        "monthly premium. Wait for the new declarations-page PDF to download "
        "and capture its filename."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="geico_address",
        task_description=task,
        expected_keys=["reference", "new_premium", "declarations_pdf"],
    )


async def submit_usps_coa(*, event_id: str, spec: dict) -> dict:
    """Agent #5 — USPS Change of Address via moversguide.usps.com."""
    origin = spec.get("origin_address", "")
    dest = spec.get("destination_address", "")
    move_date = spec.get("move_date", "")
    email = spec.get("user_email", settings.demo_email_recipient)
    card = spec.get("usps_verify_card", "")
    exp = spec.get("usps_verify_exp", "")
    cvv = spec.get("usps_verify_cvv", "")
    zipcode = spec.get("destination_zip", "")
    task = (
        "Go to https://moversguide.usps.com/mgo/start-move. Start a Family "
        f"move from {origin} to {dest} effective {move_date}. Use email "
        f"{email}. When the $1.10 identity verification charge is requested, "
        f"use prepaid Visa card {card} exp {exp} cvv {cvv} billing zip "
        f"{zipcode}. Submit. Capture the USPS confirmation number, effective "
        "date, and charge amount in cents."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="usps_coa",
        task_description=task,
        expected_keys=["confirmation_number", "effective_date", "charge_amount_cents"],
    )


async def submit_spectrum_order(*, event_id: str, spec: dict) -> dict:
    """Agent #6 — Spectrum new-customer order via spectrum.com/internet/order."""
    dest = spec.get("destination_address", "")
    move_date = spec.get("move_date", "")
    name = spec.get("user_name", "")
    email = spec.get("user_email", "")
    phone = spec.get("user_phone", "")
    task = (
        "Go to https://www.spectrum.com/internet/order. Place a new-customer "
        f"Spectrum Internet order at {dest}. Select the 500 Mbps plan with "
        f"WiFi router rental. Pick the earliest install date on or after "
        f"{move_date}, 4-hour window (any). Customer name {name}, email "
        f"{email}, phone {phone}. On the order-confirmation page capture the "
        "order number, work-order ID, install date, and install window."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="spectrum_austin",
        task_description=task,
        expected_keys=["order_number", "work_order", "install_date", "window"],
    )


async def submit_flight_search(*, event_id: str, spec: dict) -> dict:
    """Agent #13 — flight_book. Google Flights, top 3 picks with deeplinks."""
    origin_airport = spec.get("origin_airport", "SFO")
    destination_airport = spec.get("destination_airport", "AUS")
    move_date = spec.get("move_date", "")
    passengers = spec.get("household_size", 1)
    task = (
        f"Go to https://www.google.com/travel/flights and search one-way "
        f"{origin_airport} → {destination_airport} departing {move_date} for "
        f"{passengers} passenger(s). Capture the top 3 results ranked by a "
        "price + duration tradeoff (cheaper + faster wins). For each: "
        "airline, fare in USD, depart_time, arrive_time, duration, stops, "
        "and the click-through booking deeplink. Return: "
        "{'picks': [{airline, fare_usd, depart_time, arrive_time, duration, "
        "stops, book_url}, ...]}."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="flight_book",
        task_description=task,
        expected_keys=["picks"],
    )


async def submit_water_shutoff(*, event_id: str, spec: dict) -> dict:
    """Agent #14 — water_board. SFPUC MyAccount stop-service."""
    origin = spec.get("origin_address", "")
    move_date = spec.get("move_date", "")
    username = spec.get("sfpuc_username", "")
    password = spec.get("sfpuc_password", "")
    task = (
        f"Go to https://myaccount-water.sfwater.org/ and sign in with "
        f"username {username} and password {password}. Navigate to 'Stop "
        f"Service'. Enter service address {origin}, requested stop date "
        f"{move_date}. Submit. Capture: confirmation number, stop date, "
        "and the scheduled final-meter-read window."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="water_board",
        task_description=task,
        expected_keys=["confirmation_number", "stop_date", "final_meter_read"],
    )


async def submit_uscis_ar11(*, event_id: str, spec: dict) -> dict:
    """Agent #15 — uscis_ar11. Pre-fill federal AR-11 to the signature step.
    Federal law (8 USC §1305) requires the alien to sign — we stop short of
    submit and return a resume URL for the customer to sign within 10 days."""
    a_number = spec.get("a_number", "")
    user_name = spec.get("user_name", "")
    user_dob = spec.get("user_dob", "")
    origin = spec.get("origin_address", "")
    dest = spec.get("destination_address", "")
    move_date = spec.get("move_date", "")
    task = (
        "Go to https://www.uscis.gov/ar-11. Fill the address-change form "
        f"with: A-number {a_number}, full name {user_name}, DOB {user_dob}, "
        f"old address {origin}, new address {dest}, effective date "
        f"{move_date}. STOP at the signature/declaration step — DO NOT click "
        "submit. Capture: the session token, the resume URL (the page URL "
        "the customer can return to in order to sign), and a one-line "
        "'requires_user_action' note. Return: "
        "{'resume_url': str, 'session_token': str, 'requires_user_action': str}."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="uscis_ar11",
        task_description=task,
        expected_keys=["resume_url", "session_token", "requires_user_action"],
        max_steps=20,  # short — we stop at signature step
    )


async def submit_cvs_transfer(*, event_id: str, spec: dict) -> dict:
    """Agent #12 (primary) — CVS RX transfer via cvs.com/pharmacy/transfer."""
    name = spec.get("user_name", "")
    dob = spec.get("user_dob", "")
    source_name = spec.get("source_pharmacy_name", "")
    source_phone = spec.get("source_pharmacy_phone", "")
    rx_numbers = spec.get("rx_numbers", "")
    dest = spec.get("destination_address", "")
    task = (
        "Go to https://www.cvs.com/pharmacy/transfer-prescriptions. Fill the "
        f"transfer form. Patient name {name}, DOB {dob}. Source pharmacy: "
        f"{source_name} ({source_phone}). RX numbers: {rx_numbers}. "
        f"Destination: the CVS store nearest {dest}. Submit. Capture the "
        "transfer confirmation number, the destination store ID, and the "
        "pickup-ready ETA."
    )
    return await _run_task(
        event_id=event_id,
        agent_id="pharmacy",
        task_description=task,
        expected_keys=["confirmation_number", "destination_store_id", "pickup_ready_eta"],
    )

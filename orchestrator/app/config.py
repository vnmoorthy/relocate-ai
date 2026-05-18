"""Strict env config — orchestrator refuses to start if a required key is missing.

Pattern per /plan-eng-review code-quality issue 12 (pydantic-settings strict validation
at startup; fail loudly rather than discovering at 7:50 PM that AGENTPHONE_API_KEY was unset).
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # AgentPhone (mandatory — orchestrator won't run without it).
    agentphone_api_key: str
    agentphone_base_url: str = "https://api.agentphone.ai/v1"

    # Public tunnel URL for AgentPhone webhooks.
    public_base_url: str = "http://localhost:8000"

    # Lambda PAVO server (proprietary routing layer + completion).
    pavo_base_url: str = "http://129.146.122.8:8000/v1"
    pavo_api_key: str = "local-shared-secret"

    # Cloud LLM fallback.
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # Sponsors.
    stripe_secret_key: str = ""
    stripe_test_mode: bool = True
    agentmail_api_key: str = ""
    browseruse_api_key: str = ""
    sponge_api_key: str = ""
    supermemory_api_key: str = ""
    # Moss takes two credentials, not one API key.
    moss_project_id: str = ""
    moss_project_key: str = ""
    moss_index_name: str = "move-runbooks"
    # Gemini (Google DeepMind sponsor) — third LLM tier in PAVO routing.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # AgentPhone concurrency.
    agentphone_parallel_cap: int = 6

    # Synthetic mode — skip AgentPhone entirely and run fake 4-turn conversations
    # per specialist via PAVO directly. Useful for rehearsal + backup video.
    synthetic_mode: bool = False

    # App.
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"
    demo_homeowner_number: str = "+14155550100"
    demo_email_recipient: str = "vnarasingamoorthy@gmail.com"  # where AgentMail receipts go


settings = Settings()  # type: ignore[call-arg] — pydantic-settings reads from env

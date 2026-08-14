"""Strict env config — orchestrator refuses to start if a required key is missing.

Pattern per /plan-eng-review code-quality issue 12 (pydantic-settings strict validation
at startup; fail loudly rather than discovering at 7:50 PM that AGENTPHONE_API_KEY was unset).
"""
from __future__ import annotations

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # AgentPhone (mandatory — orchestrator won't run without it).
    agentphone_api_key: str
    agentphone_base_url: str = "https://api.agentphone.ai/v1"

    # Public tunnel URL for AgentPhone webhooks.
    public_base_url: str = "http://localhost:8000"

    # Lambda PAVO server (proprietary routing layer + completion).
    pavo_base_url: str = "http://127.0.0.1:8765/v1"
    pavo_api_key: str

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
    # Fail-safe outbound-email policy: every AgentMail recipient must appear in
    # this comma-separated allowlist. An empty list blocks all outbound email.
    agentmail_allowed_recipients: str = ""
    # Moss takes two credentials, not one API key.
    moss_project_id: str = ""
    moss_project_key: str = ""
    moss_index_name: str = "move-runbooks"
    # Lob.com — certified mail for comcast_cancel. Live key is fine here; charges
    # are real (~$1.40 per letter) and the e2e test gates on letter_id.
    lob_api_key: str = ""
    # Gemini (Google DeepMind sponsor) — third LLM tier in PAVO routing.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # AgentPhone concurrency.
    agentphone_parallel_cap: int = 6

    # App.
    app_env: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"
    # The synthetic trigger is disabled unless both this switch and a bearer
    # token are configured. It is never available in production.
    enable_dev_trigger: bool = False
    admin_api_token: str = ""
    # Dashboard WebSockets carry transcripts and therefore always require a
    # token, even in development.
    dashboard_api_token: str = ""
    cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    demo_homeowner_number: str = "+14155550100"
    demo_email_recipient: str = "demo.mover@example.com"

    @cached_property
    def cors_origins(self) -> list[str]:
        """Return a conservative, credential-safe CORS allowlist."""
        origins = [origin.strip() for origin in self.cors_allowed_origins.split(",")]
        return [origin for origin in origins if origin and origin != "*"]

    @property
    def agentmail_allowlist(self) -> frozenset[str]:
        """Lower-cased outbound-email allowlist. Empty means every send is blocked.

        Deliberately not cached so tests and operators can adjust the policy
        without recreating the settings singleton.
        """
        return frozenset(
            addr.strip().lower()
            for addr in self.agentmail_allowed_recipients.split(",")
            if addr.strip()
        )


# ``BaseSettings`` resolves required values from the environment at runtime;
# mypy only sees the generated model constructor and therefore expects them as
# explicit arguments.
settings = Settings()  # type: ignore[call-arg]

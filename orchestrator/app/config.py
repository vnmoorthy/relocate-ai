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
    # Demo routing: when set, EVERY outbound email is rerouted to this single
    # address (which must itself be allowlisted); the message notes the true
    # intended recipient. Lets a demo produce real artifacts without ever
    # contacting a real institution.
    agentmail_demo_recipient_override: str = ""
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

    # Durable single-node state (SQLite). Empty disables persistence — the
    # default test suite runs purely in memory.
    database_path: str = "data/relocate.db"

    # Twilio as a second telephony rail. The auth token verifies that an
    # inbound webhook genuinely came from Twilio; blank disables the rail.
    twilio_auth_token: str = ""
    twilio_account_sid: str = ""
    # E.164 number this deployment answers on, e.g. +15125551234.
    twilio_phone_number: str = ""

    # Supabase mirror. SQLite stays the source of truth; when these are set
    # every move is written through to Postgres as well. Server-side only:
    # RLS is on with no policies, so the public anon key reads nothing.
    supabase_url: str = ""
    supabase_service_key: str = ""

    # Client-IP source for rate limits and intake dedupe. True is correct
    # behind the cloudflared tunnel (every request would otherwise look like
    # 127.0.0.1 and one visitor would throttle everyone). Set false if the
    # app is ever exposed directly, where the header is caller-controlled.
    trust_proxy_headers: bool = True

    # Gated product surface (/app). Credentials live here, never in the web
    # bundle: the static page posts them and the server verifies. Blank
    # password disables the endpoint entirely.
    # A private access link (…/app/?k=KEY) signs a reviewer straight in, so
    # the credentials never have to be printed on a public page. Blank
    # disables link access and leaves only username/password.
    demo_access_key: str = ""
    demo_username: str = "demo"
    demo_password: str = ""
    demo_session_hours: int = 12

    # HMAC key for public event aliases (public_feed.public_ref). Blank falls
    # back to a per-process key: aliases rotate on restart, which tracker
    # pages self-heal from by resyncing their snapshot on reconnect.
    public_ref_secret: str = ""

    # Public website root — used in tracker-link emails.
    public_site_url: str = "https://vnmoorthy.github.io/relocate-ai"

    # Public web intake (POST /api/public/start-move). Off by default; the
    # public website enables it only for supervised demo deployments.
    enable_public_intake: bool = False

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

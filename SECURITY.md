## Reporting Security Issues

If you discover a security vulnerability, **do not open a public issue**. Email **vnarasingamoorthy@gmail.com** with the details and we'll work on it privately.

We aim to acknowledge within 48 hours and ship a fix within 7 days for high-severity issues.

## Scope

This is a hackathon project. Security considerations specific to Relocate:

- **API keys**: `.env` is gitignored. Never commit credentials. Each push to `main` is grep-scanned for known key prefixes (`sk_live_`, `sk-ant-`, `whsec_`, `AIzaSy`, etc.) before commit.
- **HMAC webhooks**: AgentPhone webhook signatures are verified before any orchestrator action (`orchestrator/app/security.py`). Stale timestamps (>5 min) are rejected.
- **PII over voice**: The buyer agent will not collect SSNs, passwords, full account numbers, or prescription numbers over the phone — those go in a follow-up email link, never in the voice channel.
- **User address data**: lives in Supermemory keyed by E.164 phone number. Customers can request deletion via reply-to-email.

## Out of scope

- Vulnerabilities in upstream dependencies (AgentPhone, AgentMail, Lob, Browser Use, Supermemory APIs). Report directly to those vendors.
- The `localhost.run` tunnel: it's an anonymous SSH reverse proxy for the demo and explicitly not a production deployment.

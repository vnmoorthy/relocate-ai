FROM ghcr.io/astral-sh/uv:0.8.8-python3.12-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/srv/relocate/.venv/bin:$PATH"

WORKDIR /srv/relocate

# PAVO uses the repository's checked-in Python lock instead of resolving the
# floating standalone requirements at image-build time.
COPY orchestrator/pyproject.toml orchestrator/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY pavo_server ./pavo_server

RUN useradd --create-home --uid 10001 relocate \
    && chown -R relocate:relocate /srv/relocate
USER relocate

EXPOSE 8765

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/readyz', timeout=2).read()"]

CMD ["uvicorn", "pavo_server.app:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1"]

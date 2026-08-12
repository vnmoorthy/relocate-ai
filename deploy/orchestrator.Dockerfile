FROM ghcr.io/astral-sh/uv:0.8.8-python3.12-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/srv/orchestrator/.venv/bin:$PATH"

WORKDIR /srv/orchestrator

COPY orchestrator/pyproject.toml orchestrator/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY orchestrator/app ./app

RUN useradd --create-home --uid 10001 relocate \
    && chown -R relocate:relocate /srv/orchestrator
USER relocate

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).read()"]

CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

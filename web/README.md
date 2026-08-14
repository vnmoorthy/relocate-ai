# Relocate dashboard

The Next.js client for Relocate, an open-source relocation-orchestration
platform in developer preview. The dashboard is static-export compatible and
has two data sources:

- **Live mode:** an authenticated WebSocket receives orchestrator events and
  reduces them into dashboard state.
- **Demo mode:** a deterministic client-side replay drives the visualization
  when live connectivity is unavailable. The panel is stamped `SIMULATION` and
  flips to `LIVE` when a real session connects.

## Development

Requires Node.js 22 and pnpm 10.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Never place a long-lived secret in a `NEXT_PUBLIC_*` variable or a URL; a
public static build cannot safely carry a live dashboard credential.

Project-wide documentation lives at the repository root: [README.md](../README.md),
[ARCHITECTURE.md](../ARCHITECTURE.md), [STATUS.md](../STATUS.md), and
[SECURITY.md](../SECURITY.md).

# What and why

<!-- Describe the change and the problem it solves. Link related issues. -->

## How verified

<!-- List the commands you ran locally. Delete lines that do not apply. -->

- [ ] `./verify-all-agents.sh` (backend lint, type, mocked tests)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` in `web/`

## Checklist

- [ ] No fabricated success paths introduced; blocked or unsafe paths still
      report `needs-user-action` or failure.
- [ ] "Submitted" and "completed" remain distinct — a provider submission ID
      is not presented as task completion.
- [ ] No secrets, keys, tokens, or personal data in the diff, fixtures, or logs.
- [ ] No external provider calls added to the default test suite or CI.
- [ ] Docs updated if behavior or capability claims changed
      (README.md, STATUS.md, AGENT_COUNT.md).

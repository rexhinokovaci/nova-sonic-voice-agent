# Contributing

## Setup

```bash
nvm use && npm ci
npm run check
npm run agent -- --scripted --say "what's my balance"   # no AWS needed
```

## Workflow

- Branch from `main`: `feat/…`, `fix/…`, `chore/…`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(router): …`, `fix(flow): …`). The changelog is built from them.
- Keep PRs small and about one thing. Flow JSON diffs are hard to review, so describe the caller-facing change in words.
- CI must be green. Prod deploys need an approval on the `production` environment.

## Conventions

- Protocol shapes live in `src/protocol/events.ts` only. Nothing else builds raw events.
- Tools never throw to the session. Return structured errors the model can talk around.
- Every tool has a timeout. The default is 1.5 s, and emergency transfer is 500 ms.
- New behaviour gets a test against `ScriptedModel`, which speaks the real protocol.
- Comments explain *why*. The code already says what.

## Templates

`templates/tool.ts` is the starting point for a new tool. ADRs use `docs/adr/template.md`.

# Security policy

## Reporting a vulnerability

Please report privately through [GitHub security advisories](https://github.com/rexhinokovaci/nova-sonic-voice-agent/security/advisories/new). Don't open a public issue. You'll get an acknowledgement within 3 working days.

## Scope notes

Treated as security bugs:

- Caller audio, transcripts or account data reaching logs or the protocol trace in production (`traceProtocol` is for development only)
- A tool acting on an account without the caller being identified by the telephony layer
- Prompt injection that makes the agent call a tool it shouldn't (e.g. a transfer or a write) without the conditions in the system prompt being met

## Practices

- AWS credentials come from the default provider chain. Nothing is stored in the repo.
- Tool inputs are validated with zod before anything runs.
- Dependabot and CodeQL run weekly and on every PR.

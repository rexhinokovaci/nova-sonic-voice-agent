# 0001. Abstract the model transport

- **Status:** Accepted
- **Date:** 2026-04-02

## Context

Bidirectional streaming is hard to test against the real service: it costs money, needs credentials in CI, isn't deterministic, and can't run in a browser.

## Decision

`VoiceSession` depends on `ModelTransport` (JSON strings in, JSON strings out), not on the Bedrock SDK. `BedrockTransport` is one implementation. `ScriptedModel` is another, and it emits the same event sequence as the service: speculative and final text, tool use, interruption.

## Consequences

- The session, tool loop, renewal and barge-in handling have fast deterministic tests.
- The playground runs the real session code in a browser.
- Risk: the fake drifts from the service. Mitigation: protocol shapes live in one module, and any discrepancy found against the real model gets a regression test in `ScriptedModel`.

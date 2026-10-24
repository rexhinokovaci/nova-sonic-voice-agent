# 0002. Renew connections with text history replay

- **Status:** Accepted
- **Date:** 2026-04-09

## Context

A Nova Sonic connection is limited to about 8 minutes. Contact centre calls regularly run longer.

## Options considered

1. **End the call at the limit.** Not acceptable.
2. **Transfer to an agent at the limit.** Safe, but it punishes long self-service calls that are going well.
3. **Open a new connection and replay context.** The caller shouldn't notice.

## Decision

Option 3. At 7 minutes, renew once the assistant finishes its current turn, never mid-sentence or mid-tool-call. The new connection gets the same system prompt and tools, then the last 12 turns as non-interactive USER/ASSISTANT text, then a fresh audio content block.

## Consequences

- Audio context (tone, pace) is lost across the boundary. Text context is kept.
- History length is a trade-off: more turns means a slower first response on the new connection. Twelve has been enough in testing. Revisit with real call lengths.
- Renewals are emitted as an event so they can be counted. A spike means calls are running long.

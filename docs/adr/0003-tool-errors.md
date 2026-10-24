# 0003. Tools return errors, they don't throw

- **Status:** Accepted
- **Date:** 2026-04-15

## Decision

`ToolRegistry.execute` never throws. Unknown tool, invalid JSON, schema failure, timeout or backend error all become `{ error: "…" }` sent back as the tool result. The system prompt tells the model to offer a transfer when a tool fails.

## Why

A thrown error ends the session, which on a phone means silence and then a dropped call. A structured error lets the model say "I can't check that right now, shall I put you through?", the same outcome the Lex IVR gives ([fail to a person](https://github.com/rexhinokovaci/amazon-connect-voice-platform/blob/main/docs/adr/0005-fail-to-a-person.md)).

## Consequences

- Tool failures show up in metrics (`tools[].ok`), not as session errors. Alert on the rate.
- Every tool needs a timeout. The registry enforces a default and aborts the `AbortSignal` so downstream calls stop.

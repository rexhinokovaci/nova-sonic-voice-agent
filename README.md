<h1>
  <img src="https://avatars.githubusercontent.com/u/55946528?v=4&s=80" width="36" height="36" align="left" alt="" />
  &nbsp;Nova Sonic voice agent
</h1>

[![CI](https://github.com/rexhinokovaci/nova-sonic-voice-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/rexhinokovaci/nova-sonic-voice-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rexhinokovaci/nova-sonic-voice-agent/actions/workflows/codeql.yml/badge.svg)](https://github.com/rexhinokovaci/nova-sonic-voice-agent/actions/workflows/codeql.yml)
[![Playground](https://github.com/rexhinokovaci/nova-sonic-voice-agent/actions/workflows/pages.yml/badge.svg)](https://rexhinokovaci.github.io/nova-sonic-voice-agent/)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

A speech-to-speech phone agent on Amazon Nova Sonic. It handles the bidirectional event stream, tool calls, barge-in, connection renewal past the 8-minute limit, telephony audio conversion and per-turn latency.

**[Open the playground](https://rexhinokovaci.github.io/nova-sonic-voice-agent/)** · [Playground guide](docs/demo-guide.md) · [Architecture](docs/architecture.md)

The playground runs the real session, tools and latency tracker in your browser against a scripted model that speaks the same protocol. You can watch every event go over the stream.

## What it handles

- **Protocol.** Typed builders for every input event and a tolerant parser for output, including speculative vs final assistant text and the `interrupted` signal.
- **Tool use.** zod-validated inputs, per-tool timeouts that abort downstream calls, structured errors instead of exceptions ([ADR 0003](docs/adr/0003-tool-errors.md)).
- **Barge-in.** Detected from the stream and surfaced so the telephony side can flush playback.
- **Long calls.** Renews before the connection cap, never mid-sentence, replaying the system prompt and recent turns ([ADR 0002](docs/adr/0002-session-renewal.md)).
- **Telephony audio.** G.711 µ-law to 16 kHz PCM16 and back, framing, WAV IO.
- **Latency.** Time to first audio, tool round trips and barge-ins per turn.
- **Testability.** `ModelTransport` abstraction with a protocol-faithful `ScriptedModel` ([ADR 0001](docs/adr/0001-transport-abstraction.md)).

## Quick start

```bash
nvm use && npm ci
npm run check                                             # typecheck, lint, format, tests

# No AWS needed: scripted model, real session and tools
npm run agent -- --scripted --say "what's my balance" --say "my power has gone off" --say "I can smell gas"

# Real model (Bedrock access to Nova Sonic required)
AWS_REGION=us-east-1 npm run agent -- --wav question.wav --out reply.wav --trace

npm run demo:serve                                        # playground on http://localhost:8080
```

## Using it

```ts
import { VoiceSession, ToolRegistry, energyTools, systemPrompt, telephonyToModel } from './src';
import { BedrockTransport } from './src/session/bedrock-transport';

const session = new VoiceSession({
  transport: new BedrockTransport({ region: 'us-east-1' }),
  tools: new ToolRegistry(energyTools(store, (handoff) => bridge.transfer(handoff))),
  systemPrompt: systemPrompt('Brightwell Energy'),
  callerPhone: call.ani,
  onEvent: (e) => {
    if (e.type === 'audio') bridge.play(e.base64);          // 24 kHz PCM16
    if (e.type === 'interrupted') bridge.flushPlayback();
    if (e.type === 'turn_complete') metrics.record(e.metrics);
  },
});
await session.start();
bridge.onAudio((mulaw) => session.sendAudio(telephonyToModel(mulaw)));
```

## Layout

```
src/protocol/    event builders + parser (the only place raw events exist)
src/session/     VoiceSession, ModelTransport, BedrockTransport, ScriptedModel
src/tools/       registry + energy tools
src/latency/     per-turn metrics
src/audio/       µ-law, resampling, framing, WAV
demo/            playground (GitHub Pages)
docs/            architecture, ADRs, runbook, playground guide
```

## Related

Part of the same portfolio as [amazon-connect-voice-platform](https://github.com/rexhinokovaci/amazon-connect-voice-platform) (the Lex IVR, whose business rules the tools share) and [contact-centre-migration-toolkit](https://github.com/rexhinokovaci/contact-centre-migration-toolkit).

## Licence

MIT. The brand and customers are fictional.

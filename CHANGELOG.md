# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/).

## [0.1.0] - 2026-10-24

### Added

- Typed Nova Sonic protocol builders and output parser, with speculative text and barge-in detection.
- `VoiceSession` with ordered scopes, tool loop, history, barge-in events and connection renewal with history replay.
- `BedrockTransport` over HTTP/2 and a protocol-faithful `ScriptedModel`.
- Tool registry with zod validation, timeouts and structured errors. Energy tools: balance, meter reading, power cut, agent and emergency transfer.
- G.711 µ-law conversion, resampling, framing and WAV IO.
- Per-turn latency tracking.
- CLI for WAV files against the real model or scripted runs.
- Browser playground with protocol stream, latency waterfall and guided tour.

[0.1.0]: https://github.com/rexhinokovaci/nova-sonic-voice-agent/releases/tag/v0.1.0

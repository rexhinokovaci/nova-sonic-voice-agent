# Playground guide

[Open the playground](https://rexhinokovaci.github.io/nova-sonic-voice-agent/). A guided tour opens on first visit. Reopen it with **Take the tour**.

## Three-minute walkthrough

1. **Start a session** as Arben. In the protocol stream, show `sessionStart`, `promptStart` (open it to see the tool schemas as JSON strings), then the SYSTEM text content.
2. **"What's my balance?"** The agent says a holding phrase, calls `lookup_balance`, then answers. In *Turn latency*, the blue bar is time to first audio and the purple bar is the tool round trip.
3. **Speculative vs final.** The grey italic text is speculative. It turns solid when the final version arrives. Only the final text goes into history.
4. **Barge in.** Ask "My power has gone off" and, while it's answering, send "talk to a person". You'll see *Caller barged in, playback flushed*.
5. **Force renewal.** The session number goes up and the protocol stream shows the history replayed as USER/ASSISTANT text.
6. **Gas.** "I can smell gas" calls `transfer_to_emergency` straight away, without a holding phrase.
7. Switch the caller to **Unknown number** and ask for the balance. The agent won't guess and offers a transfer.

## What's real

| Real (same code as production) | Simulated |
|---|---|
| `VoiceSession`, event builders and parser, tool registry and tools, turn tracker, system prompt | The model's replies (rule-based), tool backend latency (random 60-240 ms), audio (silent PCM chunks; your browser's TTS reads the text) |

## Running against the real model

```bash
export AWS_REGION=us-east-1          # a region where Nova Sonic is available
npm run agent -- --wav question.wav --out reply.wav --trace
```

Needs Bedrock model access for Nova Sonic in that account and region.

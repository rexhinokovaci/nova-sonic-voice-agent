/**
 * Streams a WAV file to Nova Sonic and writes the reply audio and a turn log.
 *
 *   AWS_REGION=us-east-1 npx tsx scripts/run-agent.ts --wav question.wav [--out reply.wav] [--phone +447700900123]
 *   npx tsx scripts/run-agent.ts --scripted --say "what's my balance"     # no AWS needed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { bytesToInt16, frames, int16ToBytes, resample } from '../src/audio/pcm';
import { readWav, writeWav } from '../src/audio/wav';
import { demoStore } from '../src/domain/accounts';
import { systemPrompt } from '../src/prompts/system-prompt';
import { BedrockTransport } from '../src/session/bedrock-transport';
import { ScriptedModel, energyBrain } from '../src/session/scripted-model';
import { VoiceSession } from '../src/session/session';
import { energyTools } from '../src/tools/energy-tools';
import { ToolRegistry } from '../src/tools/registry';

const { values } = parseArgs({
  options: {
    wav: { type: 'string' },
    out: { type: 'string', default: 'reply.wav' },
    phone: { type: 'string', default: '+447700900123' },
    scripted: { type: 'boolean', default: false },
    say: { type: 'string', multiple: true },
    trace: { type: 'boolean', default: false },
  },
});

async function main() {
  const audioOut: Buffer[] = [];
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const lines = [...(values.say ?? ["what's my balance"])];
  let expectedTurns = values.scripted ? lines.length : 1;

  const session = new VoiceSession({
    transport: values.scripted ? new ScriptedModel(energyBrain) : new BedrockTransport(),
    tools: new ToolRegistry(
      energyTools(demoStore(), (h) => console.log(`>> handoff: ${h.kind} (${h.reason})`)),
    ),
    systemPrompt: systemPrompt('Brightwell Energy'),
    callerPhone: values.phone,
    traceProtocol: values.trace,
    onEvent: (e) => {
      switch (e.type) {
        case 'user_transcript':
          console.log(`caller:    ${e.text}`);
          break;
        case 'assistant_text':
          if (!e.speculative) console.log(`assistant: ${e.text}`);
          break;
        case 'audio':
          audioOut.push(Buffer.from(e.base64, 'base64'));
          break;
        case 'tool_call':
          console.log(`  tool  -> ${e.name} ${e.input}`);
          break;
        case 'tool_result':
          console.log(
            `  tool  <- ${e.name} ${e.ok ? 'ok' : 'error'} ${e.ms}ms ${JSON.stringify(e.output)}`,
          );
          break;
        case 'turn_complete':
          console.log(
            `  turn ${e.metrics.turn}: ttfa=${e.metrics.ttfaMs?.toFixed(0) ?? '-'}ms tools=${e.metrics.tools.length}`,
          );
          if (--expectedTurns <= 0) done();
          else if (values.scripted) session.sendText(lines.shift()!);
          break;
        case 'protocol':
          console.log(`  ${e.direction === 'in' ? '→' : '←'} ${JSON.stringify(e.event)}`);
          break;
        case 'error':
          console.error(e.error);
          done();
          break;
      }
    },
  });

  await session.start();

  if (values.scripted) {
    session.sendText(lines.shift()!);
  } else {
    if (!values.wav) throw new Error('--wav is required unless --scripted');
    const wav = readWav(readFileSync(values.wav));
    if (wav.channels !== 1) throw new Error('mono WAV required');
    const pcm = int16ToBytes(resample(bytesToInt16(wav.pcm), wav.sampleRate, 16_000));
    for (const frame of frames(pcm)) {
      session.sendAudio(frame);
      await new Promise((r) => setTimeout(r, 32)); // real time, so turn detection behaves
    }
    // Trailing silence lets endpointing close the user's turn.
    for (let i = 0; i < 60; i++) {
      session.sendAudio(new Uint8Array(1024));
      await new Promise((r) => setTimeout(r, 32));
    }
  }

  await Promise.race([finished, new Promise((r) => setTimeout(r, 30_000))]);
  await session.close();

  if (audioOut.length && !values.scripted) {
    writeFileSync(values.out!, writeWav(Buffer.concat(audioOut), 24_000));
    console.log(`wrote ${values.out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

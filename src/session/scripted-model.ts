import { AsyncQueue } from './async-queue';
import type { ModelTransport } from './transport';

// A stand-in for Nova Sonic that speaks the same event protocol. It powers the
// tests and the browser demo, where calling Bedrock isn't possible. It reacts
// to typed user turns only; there is no ASR here.

export interface Plan {
  holding?: string;
  tool?: { name: string; input: Record<string, unknown> };
  reply: (toolResult?: unknown) => string;
}

export type Brain = (userText: string) => Plan;

export interface ScriptedLatency {
  asrMs: number;
  firstAudioMs: number;
  chunkMs: number;
}

const NO_DELAY: ScriptedLatency = { asrMs: 0, firstAudioMs: 0, chunkMs: 0 };
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const out = (name: string, body: Record<string, unknown>) =>
  JSON.stringify({ event: { [name]: body } });

// 24 kHz 16-bit mono silence, base64. ~40ms per chunk.
const SILENCE_CHUNK = (() => {
  const bytes = new Uint8Array(1920);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
})();

export class ScriptedModel implements ModelTransport {
  /** Every input event received, for assertions. */
  readonly received: Array<Record<string, Record<string, unknown>>> = [];

  constructor(
    private readonly brain: Brain,
    private readonly latency: ScriptedLatency = NO_DELAY,
  ) {}

  open(input: AsyncIterable<string>, signal: AbortSignal): AsyncIterable<string> {
    const output = new AsyncQueue<string>();
    const userTurns = new AsyncQueue<string>();
    const toolResults = new Map<string, (content: string) => void>();
    let interruptRequested = false;
    let speaking = false;
    const contentRoles = new Map<string, string>();
    const toolContent = new Map<string, string>();

    // Reader: route input events.
    void (async () => {
      for await (const raw of input) {
        const parsed = JSON.parse(raw) as { event: Record<string, Record<string, unknown>> };
        this.received.push(parsed.event);
        const [name, body] = Object.entries(parsed.event)[0]!;
        if (name === 'contentStart') {
          // Replayed history is non-interactive; only live user input starts a turn.
          contentRoles.set(
            String(body.contentName),
            body.interactive === true ? String(body.role) : 'HISTORY',
          );
          const cfg = body.toolResultInputConfiguration as { toolUseId?: string } | undefined;
          if (cfg?.toolUseId) toolContent.set(String(body.contentName), cfg.toolUseId);
        } else if (
          name === 'textInput' &&
          contentRoles.get(String(body.contentName)) === 'USER' &&
          body.content
        ) {
          if (speaking) interruptRequested = true;
          userTurns.push(String(body.content));
        } else if (name === 'toolResult') {
          const id = toolContent.get(String(body.contentName));
          if (id) toolResults.get(id)?.(String(body.content));
        } else if (name === 'sessionEnd') {
          break;
        }
      }
      userTurns.close();
    })();

    const assistant = async (text: string): Promise<boolean> => {
      output.push(
        out('contentStart', {
          role: 'ASSISTANT',
          type: 'TEXT',
          additionalModelFields: JSON.stringify({ generationStage: 'SPECULATIVE' }),
        }),
      );
      output.push(out('textOutput', { role: 'ASSISTANT', content: text }));
      output.push(out('contentEnd', { type: 'TEXT', stopReason: 'PARTIAL_TURN' }));
      output.push(out('contentStart', { role: 'ASSISTANT', type: 'AUDIO' }));
      speaking = true;
      await sleep(this.latency.firstAudioMs);
      const chunks = Math.max(3, Math.round(text.length / 4));
      for (let i = 0; i < chunks; i++) {
        if (interruptRequested || signal.aborted) {
          interruptRequested = false;
          speaking = false;
          output.push(
            out('textOutput', { role: 'ASSISTANT', content: '{ "interrupted" : true }' }),
          );
          output.push(out('contentEnd', { type: 'AUDIO', stopReason: 'INTERRUPTED' }));
          return false;
        }
        output.push(out('audioOutput', { content: SILENCE_CHUNK }));
        await sleep(this.latency.chunkMs);
      }
      speaking = false;
      output.push(out('contentEnd', { type: 'AUDIO', stopReason: 'END_TURN' }));
      output.push(
        out('contentStart', {
          role: 'ASSISTANT',
          type: 'TEXT',
          additionalModelFields: JSON.stringify({ generationStage: 'FINAL' }),
        }),
      );
      output.push(out('textOutput', { role: 'ASSISTANT', content: text }));
      output.push(out('contentEnd', { type: 'TEXT', stopReason: 'END_TURN' }));
      return true;
    };

    // Processor: one user turn at a time.
    void (async () => {
      let n = 0;
      for await (const text of userTurns) {
        n++;
        await sleep(this.latency.asrMs);
        output.push(out('completionStart', { completionId: `c${n}` }));
        output.push(out('contentStart', { role: 'USER', type: 'TEXT' }));
        output.push(out('textOutput', { role: 'USER', content: text }));
        output.push(out('contentEnd', { type: 'TEXT', stopReason: 'END_TURN' }));

        const plan = this.brain(text);
        let finished = true;
        if (plan.holding) finished = await assistant(plan.holding);
        let result: unknown;
        if (finished && plan.tool) {
          const toolUseId = `tool-${n}`;
          const pending = new Promise<string>((resolve) => toolResults.set(toolUseId, resolve));
          output.push(out('contentStart', { role: 'TOOL', type: 'TOOL' }));
          output.push(
            out('toolUse', {
              toolName: plan.tool.name,
              toolUseId,
              content: JSON.stringify(plan.tool.input),
            }),
          );
          output.push(out('contentEnd', { type: 'TOOL', stopReason: 'TOOL_USE' }));
          result = JSON.parse(await pending);
        }
        if (finished) await assistant(plan.reply(result));
        output.push(out('completionEnd', { stopReason: 'END_TURN' }));
      }
      output.close();
    })();

    return output;
  }
}

/** Rule-based brain for the energy assistant demo. */
export const energyBrain: Brain = (raw) => {
  const text = raw.toLowerCase();
  const digits = text.replace(/[^0-9]/g, '');

  if (/gas|carbon monoxide|\bco alarm/.test(text) && !/reading|meter/.test(text)) {
    return {
      tool: { name: 'transfer_to_emergency', input: {} },
      reply: () =>
        "Please leave the property now and don't use any switches. I'm connecting you to the gas emergency line.",
    };
  }
  if (
    /power cut|no power|power.*(off|gone|out)|lights.*(out|off)|electric.*off|outage/.test(text)
  ) {
    const pc = /\b([a-z]{1,2}\d[a-z\d]?)\s*\d[a-z]{2}\b/i.exec(raw)?.[0];
    return {
      holding: 'Let me check your area.',
      tool: { name: 'check_power_cut', input: pc ? { postcode: pc } : {} },
      reply: (r) => {
        const res = r as {
          known: boolean;
          district?: string;
          restoreBy?: string;
          customers?: number;
        };
        return res.known
          ? `Yes, there's a power cut in ${res.district} affecting about ${res.customers} homes. Engineers expect it back by ${res.restoreBy}.`
          : `I can't see a known power cut${res.district ? ` in ${res.district}` : ''}. Check your trip switch, and if it's still off I'll put you through to the team.`;
      },
    };
  }
  if (/(reading|meter)/.test(text) && digits.length >= 4) {
    const meter = /gas/.test(text) ? 'gas' : 'electricity';
    return {
      holding: `Thanks, that's ${digits.split('').join(' ')}. One moment.`,
      tool: { name: 'submit_meter_reading', input: { meter_type: meter, reading: Number(digits) } },
      reply: (r) => {
        const res = r as { accepted: boolean; reason?: string; error?: string };
        if (res.accepted) return `Done. Your ${meter} reading is in.`;
        if (res.reason === 'lower_than_previous')
          return "That's lower than your last reading. Could you check you're reading the black digits only?";
        if (res.reason === 'implausible_jump')
          return "That's much higher than we'd expect. Could you read it to me once more?";
        if (res.reason === 'caller_not_identified')
          return "I can't match this number to an account. Shall I put you through to someone?";
        return "I couldn't submit that just now. I can put you through to the team if you like.";
      },
    };
  }
  if (/reading|meter/.test(text)) {
    return {
      reply: () => 'Sure. Is it electricity or gas, and what are the black numbers on the meter?',
    };
  }
  if (/\b(balance|owe|bill|credit)\b/.test(text)) {
    return {
      holding: 'One moment while I check that.',
      tool: { name: 'lookup_balance', input: {} },
      reply: (r) => {
        const res = r as { found: boolean; firstName?: string; balance?: string };
        return res.found
          ? `Thanks ${res.firstName}. Your account is ${res.balance}.`
          : "I can't match this number to an account. I can put you through to someone who can help.";
      },
    };
  }
  if (/\b(person|agent|human|someone|advisor)\b/.test(text)) {
    return {
      tool: { name: 'transfer_to_agent', input: { reason: 'caller asked for an agent' } },
      reply: () => "No problem, I'm putting you through now.",
    };
  }
  return {
    reply: () =>
      "Sorry, I didn't quite get that. You can ask about your balance, a meter reading or a power cut.",
  };
};

import { describe, expect, it } from 'vitest';
import { demoStore } from '../src/domain/accounts';
import { ScriptedModel, energyBrain, type Brain } from '../src/session/scripted-model';
import { VoiceSession, type AgentEvent } from '../src/session/session';
import { energyTools, type Handoff } from '../src/tools/energy-tools';
import { ToolRegistry } from '../src/tools/registry';

function setup(
  opts: {
    brain?: Brain;
    phone?: string;
    renewAfterMs?: number;
    now?: () => number;
    chunkMs?: number;
  } = {},
) {
  const events: AgentEvent[] = [];
  const handoffs: Handoff[] = [];
  const model = new ScriptedModel(opts.brain ?? energyBrain, {
    asrMs: 0,
    firstAudioMs: 0,
    chunkMs: opts.chunkMs ?? 0,
  });
  let id = 0;
  const waiters: Array<() => void> = [];
  const session = new VoiceSession({
    transport: model,
    tools: new ToolRegistry(energyTools(demoStore(), (h) => handoffs.push(h))),
    systemPrompt: 'SYSTEM PROMPT',
    callerPhone: opts.phone ?? '+447700900123',
    renewAfterMs: opts.renewAfterMs,
    now: opts.now,
    newId: () => `id${++id}`,
    onEvent: (e) => {
      events.push(e);
      if (e.type === 'turn_complete') waiters.shift()?.();
    },
  });
  const turn = (text: string) =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
      session.sendText(text);
    });
  const finals = () =>
    events.flatMap((e) => (e.type === 'assistant_text' && !e.speculative ? [e.text] : []));
  return { session, model, events, handoffs, turn, finals };
}

const names = (model: ScriptedModel) => model.received.map((e) => Object.keys(e)[0]);

describe('VoiceSession', () => {
  it('opens scopes in protocol order: session, prompt, system text, audio', async () => {
    const { session, model } = setup();
    await session.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(names(model).slice(0, 6)).toEqual([
      'sessionStart',
      'promptStart',
      'contentStart',
      'textInput',
      'contentEnd',
      'contentStart',
    ]);
    expect(model.received[2]!.contentStart).toMatchObject({ role: 'SYSTEM' });
    expect(model.received[5]!.contentStart).toMatchObject({ type: 'AUDIO', role: 'USER' });
    await session.close();
  });

  it('closes scopes in reverse order', async () => {
    const { session, model } = setup();
    await session.start();
    await session.close();
    expect(names(model).slice(-3)).toEqual(['contentEnd', 'promptEnd', 'sessionEnd']);
  });

  it('runs a tool and sends the result back against the right toolUseId', async () => {
    const { session, model, turn, finals } = setup();
    await session.start();
    await turn("what's my balance");
    const toolStart = model.received.find((e) => e.contentStart?.type === 'TOOL')!;
    expect(toolStart.contentStart).toMatchObject({
      toolResultInputConfiguration: { toolUseId: 'tool-1' },
    });
    expect(finals()).toEqual([
      'One moment while I check that.',
      'Thanks Arben. Your account is £42.50 owed.',
    ]);
    await session.close();
  });

  it('records only final assistant text in metrics, not speculative', async () => {
    const { session, events, turn } = setup();
    await session.start();
    await turn('agent please');
    const metrics = events.find((e) => e.type === 'turn_complete') as Extract<
      AgentEvent,
      { type: 'turn_complete' }
    >;
    expect(metrics.metrics.assistantChars).toBe("No problem, I'm putting you through now.".length);
    expect(metrics.metrics.tools).toEqual([
      expect.objectContaining({ name: 'transfer_to_agent', ok: true }),
    ]);
    await session.close();
  });

  it('hands off gas emergencies through the emergency tool', async () => {
    const { session, handoffs, turn } = setup({ phone: '+447700900999' });
    await session.start();
    await turn('I can smell gas in the kitchen');
    expect(handoffs).toEqual([{ kind: 'emergency', reason: 'gas_emergency' }]);
    await session.close();
  });

  it('tells unidentified callers it cannot find the account', async () => {
    const { session, turn, finals } = setup({ phone: '+447700900999' });
    await session.start();
    await turn('how much do I owe');
    expect(finals().at(-1)).toMatch(/can't match this number/);
    await session.close();
  });

  it('surfaces barge-in when the caller talks over the assistant', async () => {
    const { session, events } = setup({ chunkMs: 5 });
    await session.start();
    session.sendText("what's my balance");
    await new Promise((r) => setTimeout(r, 20));
    session.sendText('actually, talk to a person');
    await new Promise((r) => setTimeout(r, 400));
    expect(events.some((e) => e.type === 'interrupted')).toBe(true);
    await session.close();
  });

  it('renews the connection and replays recent history as text', async () => {
    let t = 0;
    const { session, model, events, turn } = setup({ renewAfterMs: 1000, now: () => t });
    await session.start();
    await turn("what's my balance");
    t = 5000;
    await turn('agent please');

    expect(events.filter((e) => e.type === 'renewing')).toHaveLength(1);
    expect(
      events
        .filter((e) => e.type === 'started')
        .map((e) => (e as { sessionNumber: number }).sessionNumber),
    ).toEqual([1, 2]);

    // Second connection: system prompt, then prior turns with their roles.
    const second = model.received.slice(
      model.received.findIndex((e, i) => i > 0 && e.sessionStart),
    );
    const roles = second
      .filter((e) => e.contentStart?.type === 'TEXT')
      .map((e) => e.contentStart!.role);
    expect(roles.slice(0, 4)).toEqual(['SYSTEM', 'USER', 'ASSISTANT', 'ASSISTANT']);
    await session.close();
  });
});

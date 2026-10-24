import { TurnTracker, type TurnMetrics } from '../latency/turn-tracker';
import * as ev from '../protocol/events';
import type { InferenceConfig, InputEvent, OutputEvent } from '../protocol/events';
import type { ToolRegistry } from '../tools/registry';
import { AsyncQueue } from './async-queue';
import type { ModelTransport } from './transport';

export type AgentEvent =
  | { type: 'started'; sessionNumber: number }
  | { type: 'user_transcript'; text: string }
  | { type: 'assistant_text'; text: string; speculative: boolean }
  | { type: 'audio'; base64: string }
  | { type: 'tool_call'; name: string; input: string; toolUseId: string }
  | { type: 'tool_result'; name: string; ok: boolean; output: unknown; ms: number }
  | { type: 'interrupted' }
  | { type: 'turn_complete'; metrics: TurnMetrics }
  | { type: 'renewing'; reason: string }
  | { type: 'protocol'; direction: 'in' | 'out'; event: unknown }
  | { type: 'error'; error: Error }
  | { type: 'closed' };

export interface SessionOptions {
  transport: ModelTransport;
  tools: ToolRegistry;
  systemPrompt: string;
  voiceId?: string;
  callerPhone?: string;
  inference?: Partial<InferenceConfig>;
  /** Nova Sonic connections are capped at 8 minutes; renew comfortably before. */
  renewAfterMs?: number;
  /** Turns carried into a renewed session. */
  historyTurns?: number;
  onEvent: (e: AgentEvent) => void;
  /** Emit raw protocol events (noisy; for debugging and the demo). */
  traceProtocol?: boolean;
  newId?: () => string;
  now?: () => number;
}

interface HistoryEntry {
  role: 'USER' | 'ASSISTANT';
  text: string;
}

/**
 * One phone call. Internally this may span several model connections: when
 * the connection limit approaches, a new one is opened with the system prompt
 * and recent history replayed as text, and audio continues there.
 */
export class VoiceSession {
  private input?: AsyncQueue<string>;
  private abort?: AbortController;
  private promptName = '';
  private audioContent = '';
  private readonly history: HistoryEntry[] = [];
  private readonly tracker: TurnTracker;
  private sessionNumber = 0;
  private openedAt = 0;
  private assistantSpeaking = false;
  private renewPending = false;
  private role: ev.Role = 'ASSISTANT';
  private speculative = false;
  private pendingTool?: { name: string; toolUseId: string; content: string };
  private closed = false;
  private readonly newId: () => string;
  private readonly now: () => number;
  private reader?: Promise<void>;

  constructor(private readonly o: SessionOptions) {
    this.newId = o.newId ?? (() => crypto.randomUUID());
    this.now = o.now ?? (() => performance.now());
    this.tracker = new TurnTracker(this.now);
  }

  async start(): Promise<void> {
    await this.connect([]);
  }

  /** 16 kHz, 16-bit mono PCM. */
  sendAudio(pcm16: Uint8Array): void {
    if (this.closed || !this.input) return;
    this.maybeRenew();
    this.send(ev.audioInput(this.promptName, this.audioContent, toBase64(pcm16)));
  }

  /** Typed user turn (cross-modal input). Useful for tests, the demo and accessibility. */
  sendText(text: string): void {
    if (this.closed || !this.input) return;
    this.maybeRenew();
    const name = this.newId();
    this.send(ev.textContentStart(this.promptName, name, 'USER', true));
    this.send(ev.textInput(this.promptName, name, text));
    this.send(ev.contentEnd(this.promptName, name));
  }

  /** Renew now instead of waiting for the connection limit (ops tooling, tests, demo). */
  async forceRenew(reason = 'manual'): Promise<void> {
    if (this.closed) return;
    await this.renew(reason);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.endConnection();
    await this.reader?.catch(() => undefined);
    this.o.onEvent({ type: 'closed' });
  }

  // ---- connection lifecycle ---------------------------------------------------

  private async connect(replay: HistoryEntry[]): Promise<void> {
    this.sessionNumber++;
    this.input = new AsyncQueue<string>();
    this.abort = new AbortController();
    this.promptName = this.newId();
    this.audioContent = this.newId();
    this.openedAt = this.now();
    this.renewPending = false;

    const output = this.o.transport.open(this.input, this.abort.signal);
    const inference = { maxTokens: 1024, topP: 0.9, temperature: 0.7, ...this.o.inference };

    this.send(ev.sessionStart(inference));
    this.send(ev.promptStart(this.promptName, this.o.voiceId ?? 'amy', this.o.tools.specs()));
    this.sendSystemText(this.o.systemPrompt);
    for (const h of replay) this.sendHistory(h);
    this.send(ev.audioContentStart(this.promptName, this.audioContent));

    const input = this.input;
    this.reader = this.read(output, input);
    this.o.onEvent({ type: 'started', sessionNumber: this.sessionNumber });
  }

  private endConnection(): void {
    const input = this.input;
    if (!input || input.isClosed) return;
    // Close scopes in reverse order of opening.
    this.send(ev.contentEnd(this.promptName, this.audioContent));
    this.send(ev.promptEnd(this.promptName));
    this.send(ev.sessionEnd());
    input.close();
  }

  private maybeRenew(): void {
    const limit = this.o.renewAfterMs ?? 7 * 60_000;
    if (this.renewPending || this.now() - this.openedAt < limit) return;
    // Never cut the assistant off mid-sentence; renew once its turn ends.
    if (this.assistantSpeaking || this.pendingTool) {
      this.renewPending = true;
      return;
    }
    void this.renew('connection limit approaching');
  }

  private async renew(reason: string): Promise<void> {
    this.o.onEvent({ type: 'renewing', reason });
    const replay = this.history.slice(-(this.o.historyTurns ?? 12));
    this.endConnection();
    await this.connect(replay);
  }

  private send(e: InputEvent): void {
    if (!this.input || this.input.isClosed) return;
    if (this.o.traceProtocol && !('audioInput' in e.event))
      this.o.onEvent({ type: 'protocol', direction: 'in', event: e });
    this.input.push(JSON.stringify(e));
  }

  private sendSystemText(text: string): void {
    const name = this.newId();
    this.send(ev.textContentStart(this.promptName, name, 'SYSTEM'));
    this.send(ev.textInput(this.promptName, name, text));
    this.send(ev.contentEnd(this.promptName, name));
  }

  private sendHistory(h: HistoryEntry): void {
    const name = this.newId();
    this.send(ev.textContentStart(this.promptName, name, h.role));
    this.send(ev.textInput(this.promptName, name, h.text));
    this.send(ev.contentEnd(this.promptName, name));
  }

  // ---- output handling --------------------------------------------------------

  private async read(output: AsyncIterable<string>, input: AsyncQueue<string>): Promise<void> {
    try {
      for await (const raw of output) {
        const e = ev.parseOutput(raw);
        if (this.o.traceProtocol && e.kind !== 'audioOutput')
          this.o.onEvent({ type: 'protocol', direction: 'out', event: e });
        await this.handle(e);
      }
    } catch (err) {
      // An error on a connection we already replaced is expected noise.
      if (!this.closed && input === this.input)
        this.o.onEvent({ type: 'error', error: err as Error });
    }
  }

  private async handle(e: OutputEvent): Promise<void> {
    switch (e.kind) {
      case 'contentStart':
        this.role = e.role;
        this.speculative = e.speculative;
        if (e.role === 'ASSISTANT') this.assistantSpeaking = true;
        return;

      case 'textOutput':
        if (ev.isInterruption(e)) {
          this.tracker.bargeIn();
          this.assistantSpeaking = false;
          this.o.onEvent({ type: 'interrupted' });
          return;
        }
        if (e.role === 'USER') {
          this.tracker.userTurnEnded();
          this.history.push({ role: 'USER', text: e.content });
          this.o.onEvent({ type: 'user_transcript', text: e.content });
        } else {
          // Nova Sonic sends assistant text twice: speculative (as it's
          // generated) and final (what was actually spoken). Only the final
          // version goes into history.
          if (!this.speculative) {
            this.history.push({ role: 'ASSISTANT', text: e.content });
            this.tracker.assistantText(e.content);
          }
          this.o.onEvent({
            type: 'assistant_text',
            text: e.content,
            speculative: this.speculative,
          });
        }
        return;

      case 'audioOutput':
        this.tracker.assistantAudio();
        this.o.onEvent({ type: 'audio', base64: e.content });
        return;

      case 'toolUse':
        this.pendingTool = { name: e.toolName, toolUseId: e.toolUseId, content: e.content };
        this.o.onEvent({
          type: 'tool_call',
          name: e.toolName,
          input: e.content,
          toolUseId: e.toolUseId,
        });
        return;

      case 'contentEnd':
        if (e.type === 'TOOL' && this.pendingTool) {
          await this.runTool(this.pendingTool);
          this.pendingTool = undefined;
        } else if (this.role === 'ASSISTANT' && e.type === 'AUDIO') {
          this.assistantSpeaking = false;
        }
        return;

      case 'completionEnd':
        this.assistantSpeaking = false;
        this.o.onEvent({ type: 'turn_complete', metrics: this.tracker.snapshot() });
        if (this.renewPending) await this.renew('connection limit approaching');
        return;

      default:
        return;
    }
  }

  private async runTool(call: { name: string; toolUseId: string; content: string }): Promise<void> {
    const result = await this.o.tools.execute(call.name, call.content, {
      callerPhone: this.o.callerPhone,
    });
    this.tracker.tool(call.name, result.ms, result.ok);
    const output = result.ok ? result.output : { error: result.error };
    this.o.onEvent({ type: 'tool_result', name: call.name, ok: result.ok, output, ms: result.ms });

    const name = this.newId();
    this.send(ev.toolContentStart(this.promptName, name, call.toolUseId));
    this.send(ev.toolResult(this.promptName, name, output));
    this.send(ev.contentEnd(this.promptName, name));
  }
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

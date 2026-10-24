import type { z } from 'zod';
import type { ToolSpec } from '../protocol/events';

export interface ToolContext {
  callerPhone?: string;
  signal: AbortSignal;
}

export interface Tool<I = unknown> {
  spec: ToolSpec;
  input: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<unknown>;
  /** Hint for the latency budget; tools that call slow systems get more. */
  timeoutMs?: number;
}

export type ToolOutcome =
  { ok: true; output: unknown; ms: number } | { ok: false; error: string; ms: number };

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown>>();

  constructor(tools: Array<Tool<never>>) {
    for (const t of tools) this.tools.set(t.spec.name, t as unknown as Tool<unknown>);
  }

  specs(): ToolSpec[] {
    return [...this.tools.values()].map((t) => t.spec);
  }

  /**
   * Never throws. The model gets a structured error it can talk around
   * ("I can't check that right now") rather than the session dying.
   */
  async execute(
    name: string,
    rawInput: string,
    ctx: Omit<ToolContext, 'signal'>,
  ): Promise<ToolOutcome> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `unknown tool ${name}`, ms: ms() };

    let parsedJson: unknown;
    try {
      parsedJson = rawInput ? JSON.parse(rawInput) : {};
    } catch {
      return { ok: false, error: 'tool input was not valid JSON', ms: ms() };
    }
    const input = tool.input.safeParse(parsedJson);
    if (!input.success) {
      return {
        ok: false,
        error: `invalid input: ${input.error.issues.map((i) => i.message).join('; ')}`,
        ms: ms(),
      };
    }

    const controller = new AbortController();
    const timeout = tool.timeoutMs ?? 1500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        tool.run(input.data, { ...ctx, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`timed out after ${timeout}ms`));
          }, timeout);
        }),
      ]);
      return { ok: true, output, ms: ms() };
    } catch (err) {
      return { ok: false, error: (err as Error).message, ms: ms() };
    } finally {
      clearTimeout(timer);
    }
  }
}

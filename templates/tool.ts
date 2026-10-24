// Starting point for a new tool. Register it in src/tools/energy-tools.ts (or
// your own tool set) and add a test in test/tools.test.ts.
import { z } from 'zod';
import type { Tool } from '../src/tools/registry';

export const exampleTool: Tool<{ reference: string }> = {
  spec: {
    name: 'CHANGE_ME',
    // The model reads this to decide when to call the tool. Say when to use it
    // and when not to.
    description: 'CHANGE ME. Use when ... Do not use when ...',
    inputSchema: {
      type: 'object',
      properties: { reference: { type: 'string', description: 'CHANGE ME' } },
      required: ['reference'],
      additionalProperties: false,
    },
  },
  input: z.object({ reference: z.string().min(1).max(64) }),
  timeoutMs: 1000,
  async run(input, ctx) {
    // Pass ctx.signal to any downstream call so a timeout really cancels it.
    void ctx.signal;
    return { ok: true, reference: input.reference };
  },
};

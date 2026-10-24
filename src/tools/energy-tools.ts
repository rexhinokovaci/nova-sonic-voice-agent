import { z } from 'zod';
import { OUTAGES, formatBalance, validateReading, type AccountStore } from '../domain/accounts';
import type { Tool } from './registry';

export interface Handoff {
  kind: 'agent' | 'emergency';
  reason: string;
}

/** Tools the energy assistant can call. `onHandoff` lets the telephony layer act on transfers. */
export function energyTools(
  store: AccountStore,
  onHandoff: (h: Handoff) => void,
): Array<Tool<never>> {
  const lookupBalance: Tool<Record<string, never>> = {
    spec: {
      name: 'lookup_balance',
      description:
        "Get the caller's current account balance. Uses the caller's phone number; no input needed.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    async run(_input, ctx) {
      const account = ctx.callerPhone ? store.byPhone(ctx.callerPhone) : undefined;
      if (!account) return { found: false, say: 'not identified; offer to transfer to an agent' };
      return {
        found: true,
        firstName: account.firstName,
        balance: formatBalance(account.balancePence),
      };
    },
  };

  const submitReading: Tool<{ meter_type: 'electricity' | 'gas'; reading: number }> = {
    spec: {
      name: 'submit_meter_reading',
      description:
        'Submit a meter reading for the caller. Confirm the digits back to the caller before calling this.',
      inputSchema: {
        type: 'object',
        properties: {
          meter_type: { type: 'string', enum: ['electricity', 'gas'] },
          reading: { type: 'integer', description: 'The black digits only, as an integer.' },
        },
        required: ['meter_type', 'reading'],
        additionalProperties: false,
      },
    },
    input: z.object({
      meter_type: z.enum(['electricity', 'gas']),
      reading: z.number().int().nonnegative(),
    }),
    async run(input, ctx) {
      const account = ctx.callerPhone ? store.byPhone(ctx.callerPhone) : undefined;
      if (!account) return { accepted: false, reason: 'caller_not_identified' };
      const previous = store.lastReading(account.accountId, input.meter_type);
      const check = validateReading(input.reading, input.meter_type, previous);
      if (!check.ok) return { accepted: false, reason: check.reason, previous: previous?.value };
      store.saveReading(account.accountId, {
        meterType: input.meter_type,
        value: input.reading,
        readAt: new Date().toISOString(),
      });
      return { accepted: true };
    },
  };

  const checkPowerCut: Tool<{ postcode?: string }> = {
    spec: {
      name: 'check_power_cut',
      description:
        "Check for a known power cut. Uses the caller's postcode on file if none is given.",
      inputSchema: {
        type: 'object',
        properties: { postcode: { type: 'string', description: 'UK postcode, e.g. LS6 2AB' } },
        additionalProperties: false,
      },
    },
    input: z.object({ postcode: z.string().max(10).optional() }),
    async run(input, ctx) {
      const postcode =
        input.postcode ?? (ctx.callerPhone ? store.byPhone(ctx.callerPhone)?.postcode : undefined);
      if (!postcode) return { known: false, say: 'ask for the postcode' };
      const district = postcode.toUpperCase().trim().split(/\s+/)[0]!;
      const outage = OUTAGES[district];
      return outage ? { known: true, district, ...outage } : { known: false, district };
    },
  };

  const transferToAgent: Tool<{ reason: string }> = {
    spec: {
      name: 'transfer_to_agent',
      description:
        'Transfer the caller to a human agent. Use when asked, or after two failed attempts.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason, shown to the agent.' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
    input: z.object({ reason: z.string().min(1).max(200) }),
    async run(input) {
      onHandoff({ kind: 'agent', reason: input.reason });
      return { transferring: true };
    },
  };

  const transferToEmergency: Tool<Record<string, never>> = {
    spec: {
      name: 'transfer_to_emergency',
      description:
        'Immediately transfer to the national gas emergency line. Use for any smell of gas or CO alarm.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    timeoutMs: 500,
    async run() {
      onHandoff({ kind: 'emergency', reason: 'gas_emergency' });
      return { transferring: true };
    },
  };

  return [
    lookupBalance,
    submitReading,
    checkPowerCut,
    transferToAgent,
    transferToEmergency,
  ] as Array<Tool<never>>;
}

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { demoStore, validateReading } from '../src/domain/accounts';
import { energyBrain } from '../src/session/scripted-model';
import { energyTools } from '../src/tools/energy-tools';
import { ToolRegistry, type Tool } from '../src/tools/registry';

const registry = () => new ToolRegistry(energyTools(demoStore(), () => {}));

describe('ToolRegistry', () => {
  it('returns structured errors instead of throwing', async () => {
    const r = registry();
    expect(await r.execute('nope', '{}', {})).toMatchObject({
      ok: false,
      error: 'unknown tool nope',
    });
    expect(await r.execute('submit_meter_reading', '{bad', {})).toMatchObject({
      ok: false,
      error: 'tool input was not valid JSON',
    });
    expect(
      await r.execute('submit_meter_reading', '{"meter_type":"water","reading":1}', {}),
    ).toMatchObject({ ok: false });
  });

  it('times out slow tools and aborts them', async () => {
    let aborted = false;
    const slow: Tool<Record<string, never>> = {
      spec: { name: 'slow', description: '', inputSchema: {} },
      input: z.object({}) as unknown as z.ZodType<Record<string, never>>,
      timeoutMs: 20,
      run: (_i, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () => (aborted = true));
          setTimeout(resolve, 1000);
        }),
    };
    const r = new ToolRegistry([slow as Tool<never>]);
    expect(await r.execute('slow', '{}', {})).toMatchObject({
      ok: false,
      error: 'timed out after 20ms',
    });
    expect(aborted).toBe(true);
  });

  it('exposes JSON schemas for every tool', () => {
    for (const s of registry().specs()) expect(s.inputSchema).toMatchObject({ type: 'object' });
  });
});

describe('energy tools', () => {
  it('rejects a reading lower than the previous one', async () => {
    const out = await registry().execute(
      'submit_meter_reading',
      '{"meter_type":"electricity","reading":11000}',
      {
        callerPhone: '+447700900123',
      },
    );
    expect(out).toMatchObject({
      ok: true,
      output: { accepted: false, reason: 'lower_than_previous', previous: 12000 },
    });
  });

  it('uses the postcode on file for power cut checks', async () => {
    const out = await registry().execute('check_power_cut', '{}', { callerPhone: '+447700900456' });
    expect(out).toMatchObject({ ok: true, output: { known: true, district: 'M14' } });
  });

  it('validateReading allows normal usage and flags jumps', () => {
    const prev = { meterType: 'gas' as const, value: 1000, readAt: '2026-10-01T00:00:00Z' };
    const now = new Date('2026-10-11T00:00:00Z');
    expect(validateReading(1250, 'gas', prev, now)).toEqual({ ok: true });
    expect(validateReading(1251, 'gas', prev, now)).toEqual({
      ok: false,
      reason: 'implausible_jump',
    });
  });
});

describe('energyBrain', () => {
  it.each([
    ["what's my balance", 'lookup_balance'],
    ['my power has gone off', 'check_power_cut'], // "power" contains "owe" - regression
    ['power cut in LS6 2AB', 'check_power_cut'],
    ['my gas meter reading is 0 4 5 1 2', 'submit_meter_reading'],
    ['I can smell gas', 'transfer_to_emergency'],
    ['carbon monoxide alarm', 'transfer_to_emergency'],
    ['can I talk to a person', 'transfer_to_agent'],
  ])('"%s" -> %s', (text, tool) => {
    expect(energyBrain(text).tool?.name).toBe(tool);
  });

  it('a gas meter reading is not an emergency', () => {
    expect(energyBrain('my gas meter reading is 12345').tool).toMatchObject({
      name: 'submit_meter_reading',
      input: { meter_type: 'gas', reading: 12345 },
    });
  });
});

// Same rules as amazon-connect-voice-platform/src/domain, so the voice agent
// and the Lex IVR give callers identical answers. Keep the two in step.

export type MeterType = 'electricity' | 'gas';

export interface Account {
  accountId: string;
  firstName: string;
  phone: string;
  postcode: string;
  balancePence: number;
  priorityServicesRegister: boolean;
}

export interface Reading {
  meterType: MeterType;
  value: number;
  readAt: string;
}

export function formatBalance(pence: number): string {
  const amount = (Math.abs(pence) / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
  });
  if (pence === 0) return 'fully up to date';
  return pence < 0 ? `in credit by ${amount}` : `${amount} owed`;
}

const MAX_UNITS_PER_DAY: Record<MeterType, number> = { electricity: 60, gas: 25 };

export function validateReading(
  value: number,
  meterType: MeterType,
  previous: Reading | undefined,
  now = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(value) || value < 0 || String(value).length > 6)
    return { ok: false, reason: 'not_a_valid_reading' };
  if (!previous) return { ok: true };
  if (value < previous.value) return { ok: false, reason: 'lower_than_previous' };
  const days = Math.max(1, (now.getTime() - new Date(previous.readAt).getTime()) / 86_400_000);
  if (value - previous.value > MAX_UNITS_PER_DAY[meterType] * days)
    return { ok: false, reason: 'implausible_jump' };
  return { ok: true };
}

export class AccountStore {
  private readonly readings = new Map<string, Reading[]>();

  constructor(
    private readonly accounts: Account[],
    seed: Array<{ accountId: string } & Reading> = [],
  ) {
    for (const r of seed)
      this.readings.set(r.accountId, [...(this.readings.get(r.accountId) ?? []), r]);
  }

  byPhone(phone: string): Account | undefined {
    return this.accounts.find((a) => a.phone === phone);
  }

  lastReading(accountId: string, meterType: MeterType): Reading | undefined {
    return (this.readings.get(accountId) ?? [])
      .filter((r) => r.meterType === meterType)
      .sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
  }

  saveReading(accountId: string, reading: Reading): void {
    this.readings.set(accountId, [...(this.readings.get(accountId) ?? []), reading]);
  }
}

/** Outages keyed by postcode district. Stand-in for a network operator feed. */
export const OUTAGES: Record<string, { since: string; restoreBy: string; customers: number }> = {
  LS6: { since: '14:05', restoreBy: '18:30', customers: 412 },
  M14: { since: '12:40', restoreBy: '16:00', customers: 96 },
};

export function demoStore(): AccountStore {
  return new AccountStore(
    [
      {
        accountId: 'A100',
        firstName: 'Arben',
        phone: '+447700900123',
        postcode: 'LS6 2AB',
        balancePence: 4250,
        priorityServicesRegister: false,
      },
      {
        accountId: 'A200',
        firstName: 'Lena',
        phone: '+447700900456',
        postcode: 'M14 5RT',
        balancePence: -1200,
        priorityServicesRegister: true,
      },
    ],
    [
      {
        accountId: 'A100',
        meterType: 'electricity',
        value: 12000,
        readAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      },
    ],
  );
}

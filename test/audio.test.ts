import { describe, expect, it } from 'vitest';
import {
  bytesToInt16,
  decodeMulaw,
  frames,
  int16ToBytes,
  linearToMulaw,
  mulawToLinear,
  resample,
  telephonyToModel,
} from '../src/audio/pcm';
import { readWav, writeWav } from '../src/audio/wav';
import { TurnTracker } from '../src/latency/turn-tracker';

describe('G.711 mu-law', () => {
  it('decodes known reference values', () => {
    expect(mulawToLinear(0xff)).toBe(0);
    expect(mulawToLinear(0x7f)).toBe(0);
    expect(mulawToLinear(0x00)).toBe(-32124);
    expect(mulawToLinear(0x80)).toBe(32124);
  });

  it('round-trips within quantisation error', () => {
    for (const s of [0, 100, -100, 1000, -5000, 12000, -30000]) {
      const back = mulawToLinear(linearToMulaw(s));
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(8, Math.abs(s) * 0.07));
    }
  });
});

describe('resample', () => {
  it('doubles length 8k -> 16k and interpolates', () => {
    const out = resample(Int16Array.from([0, 100, 200]), 8000, 16000);
    expect(Array.from(out)).toEqual([0, 50, 100, 150, 200, 200]);
  });

  it('telephony frame of 20ms becomes 640 bytes of 16k PCM', () => {
    expect(telephonyToModel(new Uint8Array(160).fill(0xff)).length).toBe(640);
    expect(decodeMulaw(new Uint8Array([0xff])).length).toBe(1);
  });
});

describe('framing and wav', () => {
  it('splits into 32ms frames', () => {
    const sizes = [...frames(new Uint8Array(2500))].map((f) => f.length);
    expect(sizes).toEqual([1024, 1024, 452]);
  });

  it('wav round trip', () => {
    const pcm = int16ToBytes(Int16Array.from([1, -1, 300]));
    const wav = readWav(writeWav(pcm, 16000));
    expect(wav.sampleRate).toBe(16000);
    expect(Array.from(bytesToInt16(wav.pcm))).toEqual([1, -1, 300]);
  });

  it('rejects non-wav input', () => {
    expect(() => readWav(new Uint8Array(44))).toThrow(/not a WAV/);
  });
});

describe('TurnTracker', () => {
  it('measures time to first audio from the end of the user turn', () => {
    let t = 0;
    const tr = new TurnTracker(() => t);
    t = 1000;
    tr.userTurnEnded();
    t = 1650;
    tr.assistantAudio();
    t = 1700;
    tr.assistantAudio();
    tr.tool('lookup_balance', 120, true);
    tr.bargeIn();
    expect(tr.snapshot()).toMatchObject({
      turn: 1,
      ttfaMs: 650,
      bargeIns: 1,
      tools: [{ name: 'lookup_balance', ms: 120, ok: true }],
    });
  });
});

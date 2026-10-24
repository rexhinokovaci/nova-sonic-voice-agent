// PSTN audio arrives as 8 kHz G.711 mu-law. Nova Sonic wants 16 kHz 16-bit
// PCM in and returns 24 kHz PCM. These helpers bridge the two.

/** G.711 mu-law byte -> 16-bit linear sample. */
export function mulawToLinear(u: number): number {
  const x = ~u & 0xff;
  const sign = x & 0x80;
  const exponent = (x >> 4) & 0x07;
  const mantissa = x & 0x0f;
  const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign && magnitude ? -magnitude : magnitude;
}

/** 16-bit linear sample -> G.711 mu-law byte (for sending audio back to the PSTN). */
export function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  let s = Math.min(CLIP, Math.abs(sample)) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  s = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return s;
}

export function decodeMulaw(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = mulawToLinear(bytes[i]!);
  return out;
}

/**
 * Linear-interpolation resampler. Fine for speech going into an ASR front end;
 * not for music. Telephony is narrowband anyway, so upsampling adds no detail,
 * it just matches the rate the model expects.
 */
export function resample(input: Int16Array, fromHz: number, toHz: number): Int16Array {
  if (fromHz === toHz) return input;
  const ratio = fromHz / toHz;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(input[i0]! * (1 - frac) + input[i1]! * frac);
  }
  return out;
}

export function int16ToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return bytes;
}

export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Splits PCM into fixed-duration frames (default 32 ms at 16 kHz = 1024 bytes). */
export function* frames(pcm: Uint8Array, sampleRate = 16_000, ms = 32): Generator<Uint8Array> {
  const size = Math.round((sampleRate * ms) / 1000) * 2;
  for (let i = 0; i < pcm.length; i += size) yield pcm.subarray(i, Math.min(pcm.length, i + size));
}

/** Telephony frame (mu-law, 8 kHz) -> model input (PCM16, 16 kHz). */
export function telephonyToModel(mulaw: Uint8Array): Uint8Array {
  return int16ToBytes(resample(decodeMulaw(mulaw), 8_000, 16_000));
}

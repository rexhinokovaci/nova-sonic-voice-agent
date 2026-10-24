export interface Wav {
  sampleRate: number;
  channels: number;
  pcm: Uint8Array;
}

/** Minimal PCM16 WAV reader. Rejects anything that isn't 16-bit PCM. */
export function readWav(buf: Uint8Array): Wav {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(...buf.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bits: number; format: number } | undefined;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error('only 16-bit PCM WAV is supported');
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        pcm: buf.subarray(body, body + size),
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('no data chunk');
}

export function writeWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

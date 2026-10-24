/* eslint-disable @typescript-eslint/no-explicit-any -- asserting on loosely typed protocol JSON */
import { describe, expect, it } from 'vitest';
import * as ev from '../src/protocol/events';

describe('input events', () => {
  it('promptStart declares audio output and passes tool schemas as JSON strings', () => {
    const e = ev.promptStart('p1', 'amy', [
      { name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } },
    ]) as { event: { promptStart: Record<string, any> } };
    const p = e.event.promptStart;
    expect(p.audioOutputConfiguration).toMatchObject({
      sampleRateHertz: 24000,
      voiceId: 'amy',
      encoding: 'base64',
    });
    expect(p.toolConfiguration.tools[0].toolSpec.inputSchema.json).toBe(
      '{"type":"object","properties":{}}',
    );
  });

  it('audio input is 16 kHz 16-bit mono LPCM', () => {
    const e = ev.audioContentStart('p', 'c') as { event: { contentStart: Record<string, any> } };
    expect(e.event.contentStart.audioInputConfiguration).toMatchObject({
      mediaType: 'audio/lpcm',
      sampleRateHertz: 16000,
      sampleSizeBits: 16,
      channelCount: 1,
    });
  });

  it('tool results reference the toolUseId and carry JSON text', () => {
    const start = ev.toolContentStart('p', 'c', 'tu-1') as {
      event: { contentStart: Record<string, any> };
    };
    expect(start.event.contentStart).toMatchObject({
      type: 'TOOL',
      role: 'TOOL',
      toolResultInputConfiguration: { toolUseId: 'tu-1' },
    });
    expect(ev.toolResult('p', 'c', { a: 1 })).toEqual({
      event: { toolResult: { promptName: 'p', contentName: 'c', content: '{"a":1}' } },
    });
  });
});

describe('parseOutput', () => {
  it('detects speculative assistant content', () => {
    const e = ev.parseOutput(
      JSON.stringify({
        event: {
          contentStart: {
            role: 'ASSISTANT',
            type: 'TEXT',
            additionalModelFields: '{"generationStage":"SPECULATIVE"}',
          },
        },
      }),
    );
    expect(e).toMatchObject({ kind: 'contentStart', role: 'ASSISTANT', speculative: true });
  });

  it('survives malformed additionalModelFields', () => {
    const e = ev.parseOutput(
      JSON.stringify({
        event: { contentStart: { role: 'ASSISTANT', type: 'TEXT', additionalModelFields: '{bad' } },
      }),
    );
    expect(e).toMatchObject({ speculative: false });
  });

  it('parses tool use', () => {
    expect(
      ev.parseOutput(
        JSON.stringify({ event: { toolUse: { toolName: 'x', toolUseId: 'y', content: '{}' } } }),
      ),
    ).toEqual({
      kind: 'toolUse',
      toolName: 'x',
      toolUseId: 'y',
      content: '{}',
    });
  });

  it('passes unknown events through', () => {
    expect(ev.parseOutput('{"event":{"somethingNew":{}}}')).toEqual({
      kind: 'unknown',
      name: 'somethingNew',
    });
  });

  it('recognises the barge-in signal', () => {
    expect(
      ev.isInterruption({
        kind: 'textOutput',
        role: 'ASSISTANT',
        content: '{ "interrupted" : true }',
      }),
    ).toBe(true);
    expect(ev.isInterruption({ kind: 'textOutput', role: 'ASSISTANT', content: 'Hello' })).toBe(
      false,
    );
    expect(ev.isInterruption({ kind: 'textOutput', role: 'ASSISTANT', content: '{not json' })).toBe(
      false,
    );
  });
});

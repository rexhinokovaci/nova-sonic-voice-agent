// Nova Sonic bidirectional stream protocol. Input events are JSON objects sent
// as chunks; output events arrive the same way. Scopes nest:
// session > prompt > content, and must be opened and closed in order.
// https://docs.aws.amazon.com/nova/latest/userguide/speech-bidirection.html

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

export interface InferenceConfig {
  maxTokens: number;
  topP: number;
  temperature: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export type Role = 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';

type Event<K extends string, V> = { event: { [P in K]: V } };

export type InputEvent =
  | Event<
      'sessionStart',
      {
        inferenceConfiguration: InferenceConfig;
        turnDetectionConfiguration?: { endpointingSensitivity: 'LOW' | 'MEDIUM' | 'HIGH' };
      }
    >
  | Event<'promptStart', Record<string, unknown>>
  | Event<'contentStart', Record<string, unknown>>
  | Event<'textInput', { promptName: string; contentName: string; content: string }>
  | Event<'audioInput', { promptName: string; contentName: string; content: string }>
  | Event<'toolResult', { promptName: string; contentName: string; content: string }>
  | Event<'contentEnd', { promptName: string; contentName: string }>
  | Event<'promptEnd', { promptName: string }>
  | Event<'sessionEnd', Record<string, never>>;

export const sessionStart = (
  inferenceConfiguration: InferenceConfig,
  endpointingSensitivity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM',
): InputEvent => ({
  event: {
    sessionStart: {
      inferenceConfiguration,
      turnDetectionConfiguration: { endpointingSensitivity },
    },
  },
});

export const promptStart = (
  promptName: string,
  voiceId: string,
  tools: ToolSpec[],
): InputEvent => ({
  event: {
    promptStart: {
      promptName,
      textOutputConfiguration: { mediaType: 'text/plain' },
      audioOutputConfiguration: {
        mediaType: 'audio/lpcm',
        sampleRateHertz: OUTPUT_SAMPLE_RATE,
        sampleSizeBits: 16,
        channelCount: 1,
        voiceId,
        encoding: 'base64',
        audioType: 'SPEECH',
      },
      toolUseOutputConfiguration: { mediaType: 'application/json' },
      toolConfiguration: {
        tools: tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            // The API takes the schema as a JSON string.
            inputSchema: { json: JSON.stringify(t.inputSchema) },
          },
        })),
      },
    },
  },
});

export const textContentStart = (
  promptName: string,
  contentName: string,
  role: Exclude<Role, 'TOOL'>,
  interactive = false,
): InputEvent => ({
  event: {
    contentStart: {
      promptName,
      contentName,
      type: 'TEXT',
      interactive,
      role,
      textInputConfiguration: { mediaType: 'text/plain' },
    },
  },
});

export const audioContentStart = (promptName: string, contentName: string): InputEvent => ({
  event: {
    contentStart: {
      promptName,
      contentName,
      type: 'AUDIO',
      interactive: true,
      role: 'USER',
      audioInputConfiguration: {
        mediaType: 'audio/lpcm',
        sampleRateHertz: INPUT_SAMPLE_RATE,
        sampleSizeBits: 16,
        channelCount: 1,
        audioType: 'SPEECH',
        encoding: 'base64',
      },
    },
  },
});

export const toolContentStart = (
  promptName: string,
  contentName: string,
  toolUseId: string,
): InputEvent => ({
  event: {
    contentStart: {
      promptName,
      contentName,
      interactive: false,
      type: 'TOOL',
      role: 'TOOL',
      toolResultInputConfiguration: {
        toolUseId,
        type: 'TEXT',
        textInputConfiguration: { mediaType: 'text/plain' },
      },
    },
  },
});

export const textInput = (
  promptName: string,
  contentName: string,
  content: string,
): InputEvent => ({
  event: { textInput: { promptName, contentName, content } },
});

export const audioInput = (
  promptName: string,
  contentName: string,
  base64Pcm: string,
): InputEvent => ({
  event: { audioInput: { promptName, contentName, content: base64Pcm } },
});

export const toolResult = (
  promptName: string,
  contentName: string,
  result: unknown,
): InputEvent => ({
  event: { toolResult: { promptName, contentName, content: JSON.stringify(result) } },
});

export const contentEnd = (promptName: string, contentName: string): InputEvent => ({
  event: { contentEnd: { promptName, contentName } },
});

export const promptEnd = (promptName: string): InputEvent => ({
  event: { promptEnd: { promptName } },
});
export const sessionEnd = (): InputEvent => ({ event: { sessionEnd: {} } });

// ---- output ------------------------------------------------------------------

export type OutputEvent =
  | { kind: 'completionStart'; completionId?: string }
  | { kind: 'contentStart'; role: Role; type: string; contentId?: string; speculative: boolean }
  | { kind: 'textOutput'; role: Role; content: string }
  | { kind: 'audioOutput'; content: string }
  | { kind: 'toolUse'; toolName: string; toolUseId: string; content: string }
  | { kind: 'contentEnd'; type?: string; stopReason?: string }
  | { kind: 'completionEnd'; stopReason?: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number }
  | { kind: 'unknown'; name: string };

/** Parses one output chunk. Unknown event types are passed through, not thrown. */
export function parseOutput(raw: string): OutputEvent {
  const parsed = JSON.parse(raw) as { event?: Record<string, Record<string, unknown>> };
  const [name, body] = Object.entries(parsed.event ?? {})[0] ?? ['', {}];
  const b = body ?? {};
  switch (name) {
    case 'completionStart':
      return { kind: 'completionStart', completionId: b.completionId as string | undefined };
    case 'contentStart': {
      let speculative = false;
      if (typeof b.additionalModelFields === 'string') {
        try {
          speculative =
            (JSON.parse(b.additionalModelFields) as { generationStage?: string })
              .generationStage === 'SPECULATIVE';
        } catch {
          // Malformed extra fields shouldn't take the session down.
        }
      }
      return {
        kind: 'contentStart',
        role: b.role as Role,
        type: String(b.type ?? ''),
        contentId: b.contentId as string | undefined,
        speculative,
      };
    }
    case 'textOutput':
      return { kind: 'textOutput', role: b.role as Role, content: String(b.content ?? '') };
    case 'audioOutput':
      return { kind: 'audioOutput', content: String(b.content ?? '') };
    case 'toolUse':
      return {
        kind: 'toolUse',
        toolName: String(b.toolName),
        toolUseId: String(b.toolUseId),
        content: String(b.content ?? '{}'),
      };
    case 'contentEnd':
      return {
        kind: 'contentEnd',
        type: b.type as string | undefined,
        stopReason: b.stopReason as string | undefined,
      };
    case 'completionEnd':
      return { kind: 'completionEnd', stopReason: b.stopReason as string | undefined };
    case 'usageEvent':
      return {
        kind: 'usage',
        inputTokens: (b.details as { total?: { input?: { speechTokens?: number } } })?.total?.input
          ?.speechTokens,
        outputTokens: undefined,
      };
    default:
      return { kind: 'unknown', name };
  }
}

/** Nova Sonic signals barge-in as a textOutput whose content is this JSON. */
export function isInterruption(e: OutputEvent): boolean {
  if (e.kind !== 'textOutput') return false;
  const c = e.content.trim();
  if (!c.startsWith('{')) return false;
  try {
    return (JSON.parse(c) as { interrupted?: boolean }).interrupted === true;
  } catch {
    return false;
  }
}

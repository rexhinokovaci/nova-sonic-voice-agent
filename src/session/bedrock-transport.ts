import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import type { ModelTransport } from './transport';

export interface BedrockTransportOptions {
  region?: string;
  modelId?: string;
}

export class BedrockTransport implements ModelTransport {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(opts: BedrockTransportOptions = {}) {
    this.modelId = opts.modelId ?? process.env.NOVA_SONIC_MODEL_ID ?? 'amazon.nova-2-sonic-v1:0';
    this.client = new BedrockRuntimeClient({
      region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
      // Bidirectional streaming needs HTTP/2.
      requestHandler: new NodeHttp2Handler({
        requestTimeout: 300_000,
        sessionTimeout: 300_000,
        disableConcurrentStreams: false,
        maxConcurrentStreams: 10,
      }),
    });
  }

  async *open(input: AsyncIterable<string>, signal: AbortSignal): AsyncIterable<string> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const body = (async function* () {
      for await (const event of input) yield { chunk: { bytes: encoder.encode(event) } };
    })();

    const res = await this.client.send(
      new InvokeModelWithBidirectionalStreamCommand({ modelId: this.modelId, body }),
      { abortSignal: signal },
    );
    if (!res.body) throw new Error('Nova Sonic returned no response stream');

    for await (const part of res.body) {
      if ('chunk' in part && part.chunk?.bytes) {
        yield decoder.decode(part.chunk.bytes);
        continue;
      }
      // Any other member is a modelled exception (throttling, validation, timeout...).
      const [name, detail] = Object.entries(part)[0] ?? ['UnknownStreamError', {}];
      const message = (detail as { message?: string } | undefined)?.message ?? '';
      throw Object.assign(new Error(`${name}: ${message}`), { name });
    }
  }
}

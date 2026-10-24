/** Anything that can carry the bidirectional event stream: Bedrock, or a fake. */
export interface ModelTransport {
  open(input: AsyncIterable<string>, signal: AbortSignal): AsyncIterable<string>;
}

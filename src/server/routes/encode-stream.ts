/**
 * Encode a ReadableStream<string> into ReadableStream<Uint8Array> for HTTP responses.
 */
export function encodeStream(stream: ReadableStream<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return stream.pipeThrough(new TransformStream<string, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(chunk))
    },
  }))
}

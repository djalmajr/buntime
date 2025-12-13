/**
 * Utility functions for working with streams in the piercing gateway
 */

/**
 * Reader type that's compatible with both browser and Bun environments
 */
type StreamReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  releaseLock(): void;
};

/**
 * Concatenate multiple readable streams into one
 */
export function concatenateStreams(
  streams: ReadableStream<Uint8Array>[],
): ReadableStream<Uint8Array> {
  if (streams.length === 0) {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  }

  if (streams.length === 1) {
    return streams[0]!;
  }

  let currentIndex = 0;
  let currentReader: StreamReader | null = null;

  return new ReadableStream({
    async pull(controller) {
      while (currentIndex < streams.length) {
        if (!currentReader) {
          const stream = streams[currentIndex];
          if (!stream) break;
          currentReader = stream.getReader() as StreamReader;
        }

        const reader = currentReader;
        const { done, value } = await reader.read();

        if (done) {
          reader.releaseLock();
          currentReader = null;
          currentIndex++;
          continue;
        }

        if (value) {
          controller.enqueue(value);
        }
        return;
      }

      controller.close();
    },
    cancel() {
      currentReader?.releaseLock();
    },
  });
}

/**
 * Wrap a stream with text before and after
 */
export function wrapStreamInText(
  before: string,
  after: string,
  stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let phase: "before" | "content" | "after" | "done" = "before";
  let reader: StreamReader | null = null;

  return new ReadableStream({
    async pull(controller) {
      if (phase === "before") {
        controller.enqueue(encoder.encode(before));
        phase = "content";
        reader = stream.getReader() as StreamReader;
        return;
      }

      if (phase === "content" && reader) {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          phase = "after";
          controller.enqueue(encoder.encode(after));
          phase = "done";
          controller.close();
          return;
        }
        if (value) {
          controller.enqueue(value);
        }
        return;
      }

      if (phase === "after") {
        controller.enqueue(encoder.encode(after));
        phase = "done";
        controller.close();
      }
    },
    cancel() {
      reader?.releaseLock();
    },
  });
}

/**
 * Transform a stream by applying a function to each chunk
 */
export function transformStream(
  stream: ReadableStream<Uint8Array>,
  transformer: (text: string) => string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const transformed = transformer(text);
        controller.enqueue(encoder.encode(transformed));
      },
      flush(controller) {
        const remaining = decoder.decode();
        if (remaining) {
          controller.enqueue(encoder.encode(transformer(remaining)));
        }
      },
    }),
  );
}

/**
 * Convert a string to a readable stream
 */
export function stringToStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

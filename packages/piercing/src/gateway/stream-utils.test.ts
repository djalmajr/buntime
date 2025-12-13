import { describe, expect, it } from "bun:test";
import {
  concatenateStreams,
  stringToStream,
  transformStream,
  wrapStreamInText,
} from "./stream-utils";

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }

  result += decoder.decode();
  return result;
}

describe("stream-utils", () => {
  describe("stringToStream", () => {
    it("should convert string to stream", async () => {
      const stream = stringToStream("Hello, World!");
      const result = await streamToString(stream);
      expect(result).toBe("Hello, World!");
    });

    it("should handle empty string", async () => {
      const stream = stringToStream("");
      const result = await streamToString(stream);
      expect(result).toBe("");
    });

    it("should handle unicode characters", async () => {
      const stream = stringToStream("こんにちは 🌍");
      const result = await streamToString(stream);
      expect(result).toBe("こんにちは 🌍");
    });
  });

  describe("concatenateStreams", () => {
    it("should concatenate multiple streams", async () => {
      const stream1 = stringToStream("Hello, ");
      const stream2 = stringToStream("World");
      const stream3 = stringToStream("!");

      const combined = concatenateStreams([stream1, stream2, stream3]);
      const result = await streamToString(combined);

      expect(result).toBe("Hello, World!");
    });

    it("should handle empty array", async () => {
      const combined = concatenateStreams([]);
      const result = await streamToString(combined);
      expect(result).toBe("");
    });

    it("should handle single stream", async () => {
      const stream = stringToStream("Single");
      const combined = concatenateStreams([stream]);
      const result = await streamToString(combined);
      expect(result).toBe("Single");
    });
  });

  describe("wrapStreamInText", () => {
    it("should wrap stream with before and after text", async () => {
      const content = stringToStream("content");
      const wrapped = wrapStreamInText("<div>", "</div>", content);
      const result = await streamToString(wrapped);

      expect(result).toBe("<div>content</div>");
    });

    it("should handle empty before/after", async () => {
      const content = stringToStream("content");
      const wrapped = wrapStreamInText("", "", content);
      const result = await streamToString(wrapped);

      expect(result).toBe("content");
    });
  });

  describe("transformStream", () => {
    it("should transform stream content", async () => {
      const stream = stringToStream("hello world");
      const transformed = transformStream(stream, (text) => text.toUpperCase());
      const result = await streamToString(transformed);

      expect(result).toBe("HELLO WORLD");
    });

    it("should handle character escaping", async () => {
      const stream = stringToStream('Say "hello"');
      const transformed = transformStream(stream, (text) => text.replace(/"/g, "&quot;"));
      const result = await streamToString(transformed);

      expect(result).toBe("Say &quot;hello&quot;");
    });
  });
});

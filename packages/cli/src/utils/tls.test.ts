import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { setupTls } from "./tls";

describe("setupTls", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalEnv;
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }
  });

  it("should set NODE_TLS_REJECT_UNAUTHORIZED to 0 when insecure is true", () => {
    setupTls({ insecure: true });

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
  });

  it("should not set NODE_TLS_REJECT_UNAUTHORIZED when insecure is false", () => {
    setupTls({ insecure: false });

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("should not set NODE_TLS_REJECT_UNAUTHORIZED when insecure is undefined", () => {
    setupTls({});

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("should not modify existing NODE_TLS_REJECT_UNAUTHORIZED when insecure is false", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";

    setupTls({ insecure: false });

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("1");
  });
});

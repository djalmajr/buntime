import { describe, expect, it, mock } from "bun:test";
import { KubernetesIngressClient } from "./kubernetes.ts";

const baseOpts = {
  baseUrl: "https://kubernetes.test",
  token: "test-token",
  namespace: "platform",
  ingressName: "buntime-platform",
  serviceName: "buntime",
  servicePort: 8000,
  tlsSecretName: "buntime-platform-tls",
  ingressClassName: "traefik",
  clusterIssuer: "selfsigned-issuer",
};

const INGRESS_PATH = "/apis/networking.k8s.io/v1/namespaces/platform/ingresses/buntime-platform";
const INGRESS_LIST = "/apis/networking.k8s.io/v1/namespaces/platform/ingresses";

function makeFetch(handlers: Array<(req: Request) => Response | Promise<Response>>) {
  let index = 0;
  return mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const req = new Request(url, init);
    const handler = handlers[index++];
    if (!handler) throw new Error(`no handler for call #${index}: ${url}`);
    return handler(req);
  });
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("KubernetesIngressClient", () => {
  it("creates the Ingress when none exists (first tenant)", async () => {
    let createdBody: Record<string, unknown> | undefined;
    const fetchFn = makeFetch([
      // GET → 404
      () => new Response("not found", { status: 404 }),
      // POST → 201
      async (req) => {
        expect(req.method).toBe("POST");
        expect(new URL(req.url).pathname).toBe(INGRESS_LIST);
        createdBody = (await req.json()) as Record<string, unknown>;
        return jsonRes({ status: "ok" }, 201);
      },
    ]);

    const k8s = new KubernetesIngressClient({
      ...baseOpts,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await k8s.addIngressHost("admin.djalmajr.dev");

    expect(createdBody).toBeDefined();
    const spec = (
      createdBody as { spec: { rules: Array<{ host: string }>; tls: Array<{ hosts: string[] }> } }
    ).spec;
    expect(spec.rules[0]?.host).toBe("admin.djalmajr.dev");
    expect(spec.tls[0]?.hosts).toEqual(["admin.djalmajr.dev"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("patches the Ingress to append a rule + tls host", async () => {
    let patchBody:
      | { spec: { rules: Array<{ host: string }>; tls: Array<{ hosts: string[] }> } }
      | undefined;
    const existing = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "buntime-platform", namespace: "platform" },
      spec: {
        ingressClassName: "traefik",
        rules: [
          {
            host: "admin.djalmajr.dev",
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: "buntime", port: { number: 8000 } } },
                },
              ],
            },
          },
        ],
        tls: [{ hosts: ["admin.djalmajr.dev"], secretName: "buntime-platform-tls" }],
      },
    };
    const fetchFn = makeFetch([
      () => jsonRes(existing),
      async (req) => {
        expect(req.method).toBe("PATCH");
        expect(req.headers.get("Content-Type")).toBe("application/merge-patch+json");
        patchBody = (await req.json()) as typeof patchBody;
        return jsonRes(existing);
      },
    ]);

    const k8s = new KubernetesIngressClient({
      ...baseOpts,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await k8s.addIngressHost("tenant-7.djalmajr.dev");

    expect(patchBody?.spec.rules.map((r) => r.host)).toEqual([
      "admin.djalmajr.dev",
      "tenant-7.djalmajr.dev",
    ]);
    expect(patchBody?.spec.tls[0]?.hosts).toEqual(["admin.djalmajr.dev", "tenant-7.djalmajr.dev"]);
  });

  it("is idempotent: skip patch when host already present", async () => {
    const existing = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "buntime-platform", namespace: "platform" },
      spec: {
        rules: [
          {
            host: "admin.djalmajr.dev",
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: "buntime", port: { number: 8000 } } },
                },
              ],
            },
          },
        ],
        tls: [{ hosts: ["admin.djalmajr.dev"], secretName: "buntime-platform-tls" }],
      },
    };
    const fetchFn = makeFetch([() => jsonRes(existing)]);

    const k8s = new KubernetesIngressClient({
      ...baseOpts,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await k8s.addIngressHost("admin.djalmajr.dev");

    expect(fetchFn).toHaveBeenCalledTimes(1); // only the GET, no PATCH
  });

  it("removes the rule + tls host on remove", async () => {
    let patchBody:
      | { spec: { rules: Array<{ host: string }>; tls: Array<{ hosts: string[] }> } }
      | undefined;
    const existing = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "buntime-platform", namespace: "platform" },
      spec: {
        rules: [
          {
            host: "admin.djalmajr.dev",
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: "buntime", port: { number: 8000 } } },
                },
              ],
            },
          },
          {
            host: "tenant-7.djalmajr.dev",
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: "buntime", port: { number: 8000 } } },
                },
              ],
            },
          },
        ],
        tls: [
          {
            hosts: ["admin.djalmajr.dev", "tenant-7.djalmajr.dev"],
            secretName: "buntime-platform-tls",
          },
        ],
      },
    };
    const fetchFn = makeFetch([
      () => jsonRes(existing),
      async (req) => {
        expect(req.method).toBe("PATCH");
        patchBody = (await req.json()) as typeof patchBody;
        return jsonRes(existing);
      },
    ]);

    const k8s = new KubernetesIngressClient({
      ...baseOpts,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await k8s.removeIngressHost("tenant-7.djalmajr.dev");

    expect(patchBody?.spec.rules.map((r) => r.host)).toEqual(["admin.djalmajr.dev"]);
    expect(patchBody?.spec.tls[0]?.hosts).toEqual(["admin.djalmajr.dev"]);
  });

  it("remove is a no-op when the Ingress does not exist", async () => {
    const fetchFn = makeFetch([() => new Response("not found 404", { status: 404 })]);
    const k8s = new KubernetesIngressClient({
      ...baseOpts,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await k8s.removeIngressHost("orphan.djalmajr.dev");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sends the Bearer token on every call", async () => {
    const seen: { auth: string | null } = { auth: null };
    const fetchFn = makeFetch([
      (req) => {
        seen.auth = req.headers.get("Authorization");
        return new Response("not found 404", { status: 404 });
      },
    ]);
    const k8s = new KubernetesIngressClient({
      ...baseOpts,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await k8s.removeIngressHost("any.djalmajr.dev");
    expect(seen.auth).toBe("Bearer test-token");
  });
});

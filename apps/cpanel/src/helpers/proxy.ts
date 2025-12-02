import { curry } from "es-toolkit";

export const proxyTo = curry((url: string, req: Request): Response | Promise<Response> => {
  if (!url) {
    return new Response("URL not configured", { status: 503 });
  }

  const { pathname, search } = new URL(req.url);

  return fetch(new URL(pathname + search, url), {
    body: req.body,
    headers: req.headers,
    method: req.method,
  });
});

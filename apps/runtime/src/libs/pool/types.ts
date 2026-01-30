import type { MessageTypes } from "@/constants";

export interface WorkerRequest {
  type: typeof MessageTypes.REQUEST;
  reqId: string;
  req: {
    body: ArrayBuffer;
    headers: Record<string, string>;
    method: string;
    url: string;
  };
}

export type WorkerResponse =
  | { type: typeof MessageTypes.READY }
  | { type: typeof MessageTypes.ERROR; reqId: string; error: string; stack?: string }
  | {
      type: typeof MessageTypes.RESPONSE;
      reqId: string;
      res: {
        body: ArrayBuffer;
        headers: Record<string, string>;
        status: number;
      };
    };

export type RouteHandler = (req: Request) => Response | Promise<Response>;

export type MethodHandlers = Record<string, RouteHandler>;

export type RouteValue = Response | RouteHandler | MethodHandlers;

export type WorkerApp = {
  routes?: Record<string, RouteValue>;
  fetch?(req: Request): Response | Promise<Response>;
  onIdle?(): void;
  onTerminate?(): void;
};

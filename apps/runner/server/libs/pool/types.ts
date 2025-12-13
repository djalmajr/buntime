export type WorkerNotification = { type: "IDLE" } | { type: "TERMINATE" };

export interface WorkerRequest {
  type: "REQUEST";
  reqId: string;
  req: {
    body: ArrayBuffer;
    headers: Record<string, string>;
    method: string;
    url: string;
  };
}

export type WorkerMessage = WorkerNotification | WorkerRequest;

export type WorkerResponse =
  | { type: "READY" }
  | { type: "ERROR"; reqId: string; error: string }
  | {
      type: "RESPONSE";
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

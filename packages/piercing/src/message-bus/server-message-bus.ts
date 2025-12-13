import type { MessageBusState } from "../types";
import { GenericMessageBus } from "./message-bus";

/**
 * Header name for passing message bus state between server and client
 */
export const MESSAGE_BUS_STATE_HEADER = "x-message-bus-state";

/**
 * Server-side message bus that can serialize/deserialize state from requests
 */
export class ServerMessageBus extends GenericMessageBus {
  constructor(state: MessageBusState = {}) {
    super(state);
  }

  /**
   * Serialize the current state to a JSON string
   */
  serialize(): string {
    return JSON.stringify(this._state);
  }

  /**
   * Create a server message bus from a request's headers
   */
  static fromRequest(request: Request): ServerMessageBus {
    const stateHeader = request.headers.get(MESSAGE_BUS_STATE_HEADER);
    if (!stateHeader) {
      return new ServerMessageBus();
    }

    try {
      const state = JSON.parse(stateHeader) as MessageBusState;
      return new ServerMessageBus(state);
    } catch {
      console.warn("[MessageBus] Failed to parse state from request header");
      return new ServerMessageBus();
    }
  }

  /**
   * Create a new request with the message bus state in headers
   */
  toRequest(request: Request): Request {
    const newRequest = new Request(request);
    newRequest.headers.set(MESSAGE_BUS_STATE_HEADER, this.serialize());
    return newRequest;
  }
}

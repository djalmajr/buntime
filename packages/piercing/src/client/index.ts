// Fragment client SDK (for use inside fragments)

// MessageBus exports (lower-level API)
export {
  ClientMessageBus,
  dispatch,
  getBus as getGlobalBus,
  subscribe,
  useMessageBus,
} from "../message-bus/client-message-bus";
// Sandbox exports
export {
  createIframeSandbox,
  createMonkeyPatchSandbox,
  createSandbox,
  createServiceWorkerSandbox,
  IFRAME_CLIENT_SCRIPT,
  initPiercingServiceWorker,
  type SandboxConfig,
  type SandboxNavigateEvent,
  type SandboxStrategy,
  type SandboxStrategyHandler,
  SERVICE_WORKER_SCRIPT,
} from "../sandbox";
export {
  FRAGMENT_MESSAGE_BUS_SYMBOL,
  type FragmentHost,
  getBus,
  getFragmentHost,
  getPiercingClient,
  type PiercingClient,
  usePiercingState,
} from "./fragment-client";

// Web component exports
export {
  PiercingFragmentHost,
  PiercingFragmentOutlet,
  registerPiercingComponents,
} from "./fragment-host";

import { frameSDK } from "@zomme/frame/sdk";
import type { PropChanges } from "@zomme/frame/types";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// Global state for prop synchronization
const listeners: Set<() => void> = new Set();
let currentProps: Record<string, unknown> = {};
let globalWatcherSetup = false;

function setupGlobalWatcher() {
  if (globalWatcherSetup) return;
  globalWatcherSetup = true;

  // Initialize with current SDK props
  currentProps = { ...frameSDK.props };

  // Watch for all prop changes from SDK
  frameSDK.watch(() => {
    // Update currentProps with new values
    currentProps = { ...frameSDK.props };
    // Notify all subscribers
    for (const listener of listeners) {
      listener();
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot<T>(): T {
  return currentProps as T;
}

/**
 * React hook for using the Frame SDK
 *
 * @template T - Type of props from parent
 * @returns SDK utilities and state
 */
export function useFrameSDK<T = Record<string, unknown>>() {
  // Check if SDK was already initialized (e.g., in main.tsx)
  const alreadyInitialized = frameSDK.isInitialized;

  // Setup global watcher if SDK is initialized
  if (alreadyInitialized && !globalWatcherSetup) {
    setupGlobalWatcher();
  }

  // Use useSyncExternalStore for proper React 18 concurrent mode support
  const props = useSyncExternalStore(
    subscribe,
    () => getSnapshot<T>(),
    () => getSnapshot<T>(), // Server snapshot (same as client for this use case)
  );

  // Track ready state with useState for reactivity
  const [isReady, setIsReady] = useState(alreadyInitialized);
  const [sdkAvailable, setSdkAvailable] = useState(alreadyInitialized);

  useEffect(() => {
    // Skip if already initialized
    if (frameSDK.isInitialized) {
      if (!globalWatcherSetup) {
        setupGlobalWatcher();
        // Trigger re-render after setup
        for (const listener of listeners) {
          listener();
        }
      }
      setIsReady(true);
      setSdkAvailable(true);
      return;
    }

    frameSDK
      .initialize()
      .then(() => {
        setupGlobalWatcher();
        setIsReady(true);
        setSdkAvailable(true);
        // Trigger re-render after initialization
        for (const listener of listeners) {
          listener();
        }
      })
      .catch((error) => {
        console.warn("FrameSDK not available, running in standalone mode", error);
        setIsReady(true);
        setSdkAvailable(false);
      });
  }, []);

  const emit = useCallback(
    (event: string, data?: unknown) => {
      if (sdkAvailable) {
        frameSDK.emit(event, data);
      }
    },
    [sdkAvailable],
  );

  const on = useCallback((event: string, handler: (data: unknown) => void) => {
    return frameSDK.on(event, handler);
  }, []);

  /**
   * Watch for property changes with modern API
   */
  const watch = useCallback((handler: (changes: PropChanges<T>) => void): (() => void) => {
    // Type assertion needed because PropChanges<T> and PropChanges<FrameProps> are not compatible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (frameSDK.watch as any)(handler);
  }, []);

  /**
   * Watch for specific property changes with modern API
   */
  const watchProps = useCallback(
    <K extends keyof T>(
      propNames: K[],
      handler: (changes: PropChanges<T, K>) => void,
    ): (() => void) => {
      // Use type assertion to bypass strict type checking
      // The SDK accepts both overloads but TypeScript struggles with the union
      return (frameSDK.watch as (props: string[], handler: unknown) => () => void)(
        propNames as string[],
        handler,
      );
    },
    [],
  );

  return { emit, isReady, on, props, sdkAvailable, watch, watchProps };
}

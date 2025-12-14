import { api } from "./server/api";

/**
 * Worker entrypoint for Durable Objects plugin
 *
 * This plugin provides a REST API for managing durable objects.
 * It does not have a client-side UI.
 */
export default {
  routes: {
    "/*": api.fetch,
  },
};

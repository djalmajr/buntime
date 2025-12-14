import { api } from "./server/api";

/**
 * Worker entrypoint for KeyVal plugin
 *
 * This plugin provides a REST API for key-value operations.
 * It does not have a client-side UI.
 */
export default {
  routes: {
    "/*": api.fetch,
  },
};

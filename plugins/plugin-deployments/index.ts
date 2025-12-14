import { api } from "./server/api";

// Worker entrypoint - Bun.serve format (API-only)
export default {
  fetch: api.fetch,
};

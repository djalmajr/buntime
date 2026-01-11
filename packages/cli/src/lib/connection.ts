import { getLastServerId, getServerById, getServers, type ServerConfig } from "./config-db.js";

const DEFAULT_URL = "http://localhost:8000";

/**
 * CLI arguments passed at startup
 */
export interface CliArgs {
  insecure?: boolean;
  token?: string;
  url?: string;
}

/**
 * Resolution source for debugging/logging
 */
export type ConnectionSource = "cli" | "default" | "env" | "interactive" | "sqlite";

/**
 * Resolved connection configuration
 */
export interface ResolvedConnection {
  insecure: boolean;
  name?: string;
  serverId?: number;
  source: ConnectionSource;
  token: string | null;
  url: string;
}

/**
 * Connection resolution result
 */
export type ConnectionResolution =
  | { type: "add_server" }
  | { connection: ResolvedConnection; type: "direct" }
  | { servers: ServerConfig[]; type: "select_server" };

/**
 * Get environment variables for connection
 */
function getEnvConfig(): Partial<ResolvedConnection> {
  const url = process.env.BUNTIME_URL;
  const token = process.env.BUNTIME_TOKEN;
  const insecure = process.env.BUNTIME_INSECURE === "true" || process.env.BUNTIME_INSECURE === "1";

  if (!url) return {};

  return {
    insecure,
    source: "env",
    token: token ?? null,
    url,
  };
}

/**
 * Resolve connection based on priority:
 * 1. CLI arguments
 * 2. Environment variables
 * 3. SQLite config (last used server or server selection)
 * 4. Interactive setup (add server)
 * 5. Default (localhost:8000)
 */
export function resolveConnection(args: CliArgs): ConnectionResolution {
  // 1. CLI arguments have highest priority
  if (args.url) {
    return {
      connection: {
        insecure: args.insecure ?? false,
        source: "cli",
        token: args.token ?? null,
        url: args.url,
      },
      type: "direct",
    };
  }

  // 2. Environment variables
  const envConfig = getEnvConfig();
  if (envConfig.url) {
    return {
      connection: {
        insecure: envConfig.insecure ?? false,
        source: "env",
        token: envConfig.token ?? null,
        url: envConfig.url,
      },
      type: "direct",
    };
  }

  // 3. SQLite config
  const servers = getServers();

  if (servers.length === 0) {
    // No servers saved - need to add first server
    return { type: "add_server" };
  }

  if (servers.length === 1) {
    // Only one server - use it directly
    const server = servers[0]!;
    return {
      connection: {
        insecure: server.insecure,
        name: server.name,
        serverId: server.id,
        source: "sqlite",
        token: server.token,
        url: server.url,
      },
      type: "direct",
    };
  }

  // Multiple servers - check for last used
  const lastServerId = getLastServerId();
  if (lastServerId) {
    const lastServer = getServerById(lastServerId);
    if (lastServer) {
      return {
        connection: {
          insecure: lastServer.insecure,
          name: lastServer.name,
          serverId: lastServer.id,
          source: "sqlite",
          token: lastServer.token,
          url: lastServer.url,
        },
        type: "direct",
      };
    }
  }

  // Multiple servers, no last used - show selection
  return { servers, type: "select_server" };
}

/**
 * Get default connection (fallback)
 */
export function getDefaultConnection(): ResolvedConnection {
  return {
    insecure: false,
    source: "default",
    token: null,
    url: DEFAULT_URL,
  };
}

/**
 * Create connection from server config
 */
export function connectionFromServer(server: ServerConfig): ResolvedConnection {
  return {
    insecure: server.insecure,
    name: server.name,
    serverId: server.id,
    source: "sqlite",
    token: server.token,
    url: server.url,
  };
}

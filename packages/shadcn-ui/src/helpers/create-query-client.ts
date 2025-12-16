import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

export interface CreateQueryClientOptions {
  refetchOnWindowFocus?: boolean;
  retry?: number | false;
  staleTime?: number;
}

const DEFAULT_OPTIONS: CreateQueryClientOptions = {
  refetchOnWindowFocus: false,
  retry: 1,
  staleTime: 1000 * 60, // 1 minute
};

export function createQueryClient(options: CreateQueryClientOptions = {}): QueryClient {
  const config: QueryClientConfig = {
    defaultOptions: {
      queries: {
        ...DEFAULT_OPTIONS,
        ...options,
      },
    },
  };

  return new QueryClient(config);
}

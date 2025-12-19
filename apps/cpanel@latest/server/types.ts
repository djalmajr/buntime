export interface Identity {
  claims: Record<string, unknown>;
  groups: string[];
  roles: string[];
  sub: string;
}

export function parseIdentity(header: string | undefined): Identity | null {
  if (!header) return null;
  try {
    return JSON.parse(header);
  } catch {
    return null;
  }
}

import Keycloak from "keycloak-js";
import type { AuthConfig } from "./config";

/**
 * Initialize Keycloak for this host's realm with login-required (PKCE). The
 * realm/url/clientId come from the per-host config the worker injected.
 */
export async function initKeycloak(cfg: AuthConfig): Promise<Keycloak> {
  const keycloak = new Keycloak({ url: cfg.url, realm: cfg.realm, clientId: cfg.clientId });
  await keycloak.init({
    onLoad: "login-required",
    pkceMethod: "S256",
    checkLoginIframe: false,
  });
  return keycloak;
}

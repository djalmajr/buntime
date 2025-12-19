import type { Context, Next } from "hono";

// Rotas públicas (assets estáticos)
const PUBLIC_PATTERNS = [/\.(js|css|woff2?|png|svg|ico|json|map)$/];

// Cache do status do plugin-authn
let authnEnabled: boolean | undefined;

async function isAuthnEnabled(): Promise<boolean> {
  if (authnEnabled !== undefined) return authnEnabled;

  try {
    const res = await fetch(
      `${Bun.env.BUNTIME_URL || "http://localhost:8000"}/api/plugins`,
    );
    const plugins = await res.json();
    authnEnabled = plugins.some(
      (p: { name: string }) => p.name === "@buntime/plugin-authn",
    );
  } catch {
    authnEnabled = false;
  }
  return authnEnabled as boolean;
}

export async function authMiddleware(ctx: Context, next: Next) {
  const path = new URL(ctx.req.url).pathname;

  // Assets estáticos não precisam de auth
  if (PUBLIC_PATTERNS.some((p) => p.test(path))) {
    return next();
  }

  // Verifica X-Identity injetado pelo plugin-authn
  const identity = ctx.req.header("X-Identity");

  if (!identity) {
    // Se plugin-authn não está habilitado, permite acesso (modo dev)
    if (!(await isAuthnEnabled())) {
      return next();
    }

    // Plugin-authn habilitado mas sem identity → redireciona para login
    const loginUrl = `/auth/login?redirect=${encodeURIComponent(ctx.req.url)}`;
    return ctx.redirect(loginUrl);
  }

  // Usuário autenticado - continua
  return next();
}

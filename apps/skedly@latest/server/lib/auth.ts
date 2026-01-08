import { createId } from "@paralleldrive/cuid2";
import { betterAuth, type Session, type User } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import * as schema from "../schemas";
import type { SocialProfile } from "../types/auth";
import { generateSalt, hashPassword, verifyPassword } from "../utils/password";
import { type DB, getDb } from "./db";

export type Env = {
  ALLOWED_ORIGINS: string;
  DATABASE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SKEDLY_BA_HASH: string;
};

export type CfEnv = {
  Bindings: Env;
  Variables: {
    user: User | null;
    session: Session | null;
  };
};

export async function googleOnSignIn(db: DB, profile: SocialProfile) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, profile.email));

  if (user) {
    return { ...user, role: "user" };
  }

  const [newUser] = await db
    .insert(schema.users)
    .values({
      email: profile.email,
      name: profile.name ?? "",
      image: profile.image ?? undefined,
      role: "user",
    })
    .returning();

  return newUser;
}

export async function adminSignIn(db: DB, credentials: { email: string; password: string }) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, credentials.email));

  if (!user || user.role !== "admin") {
    return null;
  }

  const [account] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, user.id));

  if (account?.password && (await verifyPassword(account.password, credentials.password))) {
    return user;
  }

  return null;
}

export const getAuth = (
  ctx: {
    req: { url: string; raw: Request };
    env?: Env;
  },
  db?: DB,
) => {
  // Use process.env as fallback for Buntime workers (ctx.env is for Cloudflare Workers)
  const env = ctx.env ?? (process.env as unknown as Env);
  const { SKEDLY_BA_HASH, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_ORIGINS = "*" } = env;
  const database = db || getDb();

  return betterAuth({
    name: "Skedly",
    secret: SKEDLY_BA_HASH,
    origin: ctx.req.url,
    trustedOrigins: ALLOWED_ORIGINS.split(","),
    theme: {
      logo: "/logo.png",
    },
    emailAndPassword: {
      enabled: true,
    },
    credentials: {
      signIn: (cred: { email: string; password: string }) => {
        return adminSignIn(database, cred);
      },
      signUp: async (credentials: { email: string; password: string }) => {
        const [existingUser] = await database
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, credentials.email));

        if (existingUser) {
          throw new Error("User already exists");
        }

        const salt = generateSalt();
        const hashedPassword = await hashPassword(credentials.password, salt);

        const [newUser] = await database
          .insert(schema.users)
          .values({
            email: credentials.email,
            name: "Admin User",
            role: "admin",
          })
          .returning();

        await database.insert(schema.accounts).values({
          id: createId(),
          userId: newUser.id,
          providerId: "credentials",
          accountId: newUser.id,
          password: `${salt}:${hashedPassword}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        return newUser;
      },
    },
    socialProviders: {
      google: {
        prompt: "select_account",
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        onSignIn: (profile: SocialProfile) => googleOnSignIn(database, profile),
      },
    },
    additionalFields: {
      cookie: {
        cookieOptions: {
          sameSite: "none",
        },
      },
    },
    database: drizzleAdapter(database, {
      provider: "sqlite",
      usePlural: false,
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
  });
};

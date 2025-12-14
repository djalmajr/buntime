import { createPluginBuilder } from "@buntime/shared/build";

createPluginBuilder({
  name: "plugin-authn",
  client: true,
  external: ["@buntime/shared", "hono", "better-auth"],
}).run();

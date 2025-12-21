import { createAppBuilder } from "@buntime/shared/build";

createAppBuilder({
  name: "papiros",
  external: ["asciidoctor"],
}).run();

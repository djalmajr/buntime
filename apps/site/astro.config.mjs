// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import remarkGfm from "remark-gfm";

const SITE_URL = "https://buntime.djalmajr.dev";
const REPO_URL = "https://github.com/djalmajr/buntime";

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  // Starlight processes .md with GFM, but the MDX pipeline needs remark-gfm
  // declared here (it inherits `markdown` config) so tables render in .mdx too.
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  integrations: [
    starlight({
      title: "Buntime",
      description:
        "A Bun runtime with an isolated worker pool, a plugin system, and a micro-frontend shell.",
      logo: {
        src: "./src/assets/logo.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      head: [
        {
          tag: "script",
          attrs: { src: "/external-links.js", defer: true },
        },
      ],
      social: [{ icon: "github", label: "GitHub", href: REPO_URL }],
      lastUpdated: true,
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        pt: { label: "Português", lang: "pt-BR" },
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start Here",
          translations: { "pt-BR": "Comece aqui" },
          items: [{ autogenerate: { directory: "start" } }],
        },
        {
          label: "Core Concepts",
          translations: { "pt-BR": "Conceitos" },
          items: [{ autogenerate: { directory: "concepts" } }],
        },
        {
          label: "Guides",
          translations: { "pt-BR": "Guias" },
          items: [{ autogenerate: { directory: "guides" } }],
        },
        {
          label: "Plugins",
          translations: { "pt-BR": "Plugins" },
          items: [{ autogenerate: { directory: "plugins" } }],
        },
        {
          label: "Packages",
          translations: { "pt-BR": "Pacotes" },
          items: [{ autogenerate: { directory: "packages" } }],
        },
        {
          label: "Platform",
          translations: { "pt-BR": "Plataforma" },
          items: [{ autogenerate: { directory: "platform" } }],
        },
        {
          label: "Operations",
          translations: { "pt-BR": "Operações" },
          items: [{ autogenerate: { directory: "ops" } }],
        },
        {
          label: "Reference",
          translations: { "pt-BR": "Referência" },
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});

import { join } from "node:path";

export const CONTENT_DIR = join(import.meta.dir, "..", "content");

export const SUPPORTED_LANGS = ["pt", "en"] as const;

export const DEFAULT_LANG = "pt";

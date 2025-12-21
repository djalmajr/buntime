import { DEFAULT_LANG, SUPPORTED_LANGS } from "@/constants";
import { listDir } from "@/utils/s3";

/**
 * Check if a language folder exists for a project in S3
 */
export async function hasLanguage(projectName: string, lang: string): Promise<boolean> {
  try {
    // Try to list contents of the language folder
    const entries = await listDir(`${projectName}/${lang}`);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Normalize language code (e.g., pt-BR → pt, en-US → en)
 */
export function normalizeLanguage(lang: string): string {
  const baseLang = lang.split("-")[0].toLowerCase();
  return SUPPORTED_LANGS.includes(baseLang as (typeof SUPPORTED_LANGS)[number])
    ? baseLang
    : DEFAULT_LANG;
}

/**
 * Get available language for a project (returns requested or fallback)
 */
export async function getAvailableLanguage(
  projectName: string,
  requestedLang: string,
): Promise<string | null> {
  // Normalize language code (pt-BR → pt, en-US → en)
  const normalizedLang = normalizeLanguage(requestedLang);

  // Try normalized language first
  if (await hasLanguage(projectName, normalizedLang)) {
    return normalizedLang;
  }

  // Try other supported languages as fallback
  for (const lang of SUPPORTED_LANGS) {
    if (lang !== normalizedLang && (await hasLanguage(projectName, lang))) {
      return lang;
    }
  }

  return null;
}

import type { TFunction } from "i18next";

export interface ApiErrorResponse {
  code: string;
  data?: Record<string, unknown>;
  message: string;
}

/**
 * Parse API error and return translated message
 * @param error - Error object from API
 * @param t - i18next translation function (common namespace)
 * @param fallbackMessage - Fallback message if translation not found
 * @returns Translated error message
 */
export function parseApiError(error: unknown, t: TFunction, fallbackMessage: string): string {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  try {
    // Try to extract JSON from error message
    const match = error.message.match(/\{[\s\S]*\}/);
    if (!match) {
      return error.message;
    }

    const errorData = JSON.parse(match[0]) as ApiErrorResponse;

    // Check if we have a translation for this error code
    if (errorData.code) {
      const translationKey = `errors.${errorData.code}`;
      const translated = t(translationKey, {
        defaultValue: "",
        ...errorData.data,
      });

      // If translation exists (not empty string), use it
      if (translated) {
        return translated;
      }
    }

    // Fallback to message from API
    return errorData.message || error.message;
  } catch {
    // If parsing fails, return original error message
    return error.message;
  }
}

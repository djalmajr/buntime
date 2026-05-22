import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import { useApiKey } from "~/contexts/api-key-auth-context";
import { RuntimeApiError } from "~/helpers/api-client";

function getErrorMessage(error: unknown): string {
  if (error instanceof RuntimeApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

/**
 * Login form for the cpanel.
 *
 * Submits the operator key to `POST /api/admin/session`. The runtime
 * validates it and issues an HttpOnly `buntime_api_key` cookie that the
 * browser attaches to every same-origin request afterwards (including
 * plugin micro-frontend iframes). JavaScript never persists the key.
 */
export function ApiKeyLogin() {
  const { t } = useTranslation();
  const { authenticate, status } = useApiKey();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await authenticate(apiKey);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-background flex min-h-screen w-full items-center justify-center p-4">
      <form
        className="border-border bg-background w-full max-w-md rounded-md border p-5 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
            <Icon icon="lucide:key-round" className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">{t("admin.login.title")}</h1>
            <p className="text-muted-foreground text-sm">{t("admin.login.description")}</p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium" htmlFor="cpanel-api-key">
          {t("admin.login.apiKey")}
        </label>
        <Input
          autoComplete="off"
          className="mt-2"
          id="cpanel-api-key"
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          value={apiKey}
        />

        {error && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <Button className="mt-4 w-full" disabled={!apiKey.trim() || submitting} type="submit">
          {submitting || status === "checking" ? (
            <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
          ) : (
            <Icon icon="lucide:log-in" className="size-4" />
          )}
          {t("admin.login.submit")}
        </Button>
      </form>
    </div>
  );
}

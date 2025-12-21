import { Icon, ModeToggle, ThemeProvider } from "@buntime/shadcn-ui";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "~/components/language-switcher";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { t } = useTranslation();

  return (
    <ThemeProvider defaultTheme="system" storageKey="docs:theme">
      <div className="absolute inset-0 overflow-hidden flex flex-col">
        <header className="border-b bg-background px-3 py-2">
          <div className="flex items-center justify-between">
            <Link className="flex items-center gap-2" to="/">
              <Icon className="size-6 text-primary" icon="lucide:book-open" />
              <span className="text-xl font-bold">{t("title")}</span>
            </Link>
            <div className="flex items-center gap-1">
              <LanguageSwitcher />
              <ModeToggle />
            </div>
          </div>
        </header>
        <Outlet />
      </div>
    </ThemeProvider>
  );
}

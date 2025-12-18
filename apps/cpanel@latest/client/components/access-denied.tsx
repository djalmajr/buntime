import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Icon,
} from "@buntime/shadcn-ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/contexts/auth-context";

export function AccessDenied() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleGoBack = () => {
    navigate({ to: "/" });
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
            <Icon className="size-8 text-destructive" icon="lucide:shield-x" />
          </div>
          <CardTitle className="text-2xl">{t("auth.accessDenied")}</CardTitle>
          <CardDescription>{t("auth.accessDeniedDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" variant="default" onClick={handleGoBack}>
            <Icon className="mr-2 size-4" icon="lucide:home" />
            {t("auth.goHome")}
          </Button>
          <Button className="w-full" variant="outline" onClick={handleLogout}>
            <Icon className="mr-2 size-4" icon="lucide:log-out" />
            {t("auth.logout")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

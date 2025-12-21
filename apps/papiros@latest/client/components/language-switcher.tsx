import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@buntime/shadcn-ui";
import { useTranslation } from "react-i18next";

const languages = [
  { code: "en", flag: "🇺🇸", label: "English" },
  { code: "es", flag: "🇪🇸", label: "Español" },
  { code: "pt", flag: "🇧🇷", label: "Português" },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const currentLanguage = languages.find((lang) => lang.code === i18n.language) ?? languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-1.5" size="sm" variant="ghost">
          <span className="text-base leading-none">{currentLanguage.flag}</span>
          <span className="text-xs font-medium uppercase">{currentLanguage.code}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => {
          const isSelected = i18n.language === lang.code;
          return (
            <DropdownMenuItem key={lang.code} onClick={() => i18n.changeLanguage(lang.code)}>
              <span className="mr-2 text-base leading-none">{lang.flag}</span>
              <span className={isSelected ? "font-semibold" : ""}>{lang.label}</span>
              {isSelected && <Icon className="ml-auto size-4" icon="lucide:check" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

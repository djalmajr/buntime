import { useTranslation } from "react-i18next";
import { LANGUAGE_STORAGE_KEY } from "../helpers/create-i18n";
import { DropdownMenuGroup, DropdownMenuItem } from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

const languages = [
  { code: "en", flag: "🇺🇸", label: "English" },
  { code: "pt", flag: "🇧🇷", label: "Português" },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const handleLanguageChange = (languageCode: string) => {
    i18n.changeLanguage(languageCode);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode);
  };

  return (
    <DropdownMenuGroup>
      {languages.map((lang) => (
        <DropdownMenuItem
          className="gap-2"
          key={lang.code}
          onClick={() => handleLanguageChange(lang.code)}
        >
          <span className="text-lg">{lang.flag}</span>
          <span className="flex-1">{lang.label}</span>
          {i18n.language === lang.code && <Icon className="size-4" icon="lucide:check" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

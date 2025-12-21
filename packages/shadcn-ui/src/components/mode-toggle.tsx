import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

const themes = [
  { icon: "lucide:sun", key: "light", label: "Light" },
  { icon: "lucide:moon", key: "dark", label: "Dark" },
  { icon: "lucide:monitor", key: "system", label: "System" },
] as const;

const themeIcons = {
  dark: "lucide:moon",
  light: "lucide:sun",
  system: "lucide:monitor",
} as const;

interface ModeToggleProps {
  labels?: {
    dark?: string;
    light?: string;
    system?: string;
    toggleTheme?: string;
  };
}

function ModeToggle({ labels }: ModeToggleProps = {}) {
  const { setTheme, theme } = useTheme();

  const getLabel = (key: "dark" | "light" | "system") => {
    return labels?.[key] ?? themes.find((t) => t.key === key)?.label ?? key;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <Icon className="size-5" icon={themeIcons[theme]} />
          <span className="sr-only">{labels?.toggleTheme ?? "Toggle theme"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themes.map(({ icon, key }) => {
          const isSelected = theme === key;
          return (
            <DropdownMenuItem key={key} onClick={() => setTheme(key)}>
              <Icon className="mr-2 text-base" icon={icon} />
              <span className={isSelected ? "font-semibold" : ""}>{getLabel(key)}</span>
              {isSelected && <Icon className="ml-auto size-4" icon="lucide:check" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ModeToggle, type ModeToggleProps };

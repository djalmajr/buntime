import { Icon } from "~/components/icon";
import { cn } from "~/libs/cn";
import { type Theme, themeList } from "~/libs/themes";

interface SettingsPanelProps {
  theme: Theme;
  onThemeChange: (themeId: string) => void;
}

export function SettingsPanel({ theme, onThemeChange }: SettingsPanelProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-4" name="lucide:palette" />
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
          Color Theme
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {themeList.map((t) => (
          <button
            type="button"
            className={cn(
              "hover:bg-accent flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
              theme.id === t.id && "bg-accent",
            )}
            key={t.id}
            onClick={() => onThemeChange(t.id)}
          >
            <div
              className="size-4 rounded border"
              style={{
                backgroundColor: t.colors.bg,
                borderColor: t.colors.border,
              }}
            />
            <span className="text-foreground flex-1">{t.name}</span>
            {theme.id === t.id && <Icon className="text-primary size-4" name="lucide:check" />}
            <span className="text-muted-foreground text-xs capitalize">{t.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { Icon } from "~/components/icon";
import { cn } from "~/helpers/cn";

interface ThemeCardProps {
  colors: { accent: string; bg: string; bgSecondary: string; text: string };
  isSelected: boolean;
  name: string;
  type: "dark" | "light";
  onClick: () => void;
}

export function ThemeCard({ colors, isSelected, name, type, onClick }: ThemeCardProps) {
  return (
    <button
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border-2 transition-all hover:scale-[1.02]",
        isSelected ? "border-primary ring-primary/20 ring-2" : "hover:border-primary/50",
      )}
      type="button"
      onClick={onClick}
    >
      {/* Theme Preview */}
      <div className="flex h-32 flex-col p-3" style={{ backgroundColor: colors.bg }}>
        {/* Fake window header */}
        <div
          className="mb-2 flex items-center gap-1.5 rounded px-2 py-1"
          style={{ backgroundColor: colors.bgSecondary }}
        >
          <div className="size-2 rounded-full bg-red-500/80" />
          <div className="size-2 rounded-full bg-yellow-500/80" />
          <div className="size-2 rounded-full bg-green-500/80" />
          <div
            className="ml-2 h-1.5 w-16 rounded"
            style={{ backgroundColor: colors.text, opacity: 0.3 }}
          />
        </div>
        {/* Fake code lines */}
        <div className="flex flex-1 flex-col gap-1.5 px-1">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-8 rounded" style={{ backgroundColor: colors.accent }} />
            <div
              className="h-1.5 w-12 rounded"
              style={{ backgroundColor: colors.text, opacity: 0.6 }}
            />
          </div>
          <div className="flex items-center gap-2 pl-4">
            <div
              className="h-1.5 w-10 rounded"
              style={{ backgroundColor: colors.text, opacity: 0.4 }}
            />
            <div
              className="h-1.5 w-6 rounded"
              style={{ backgroundColor: colors.accent, opacity: 0.7 }}
            />
          </div>
          <div className="flex items-center gap-2 pl-4">
            <div
              className="h-1.5 w-14 rounded"
              style={{ backgroundColor: colors.text, opacity: 0.5 }}
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-6 rounded" style={{ backgroundColor: colors.accent }} />
          </div>
        </div>
      </div>

      {/* Theme Info */}
      <div className="flex items-center justify-between border-t bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs capitalize">
            {type}
          </span>
        </div>
        {isSelected && (
          <div className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full">
            <Icon className="size-3" name="lucide:check" />
          </div>
        )}
      </div>
    </button>
  );
}

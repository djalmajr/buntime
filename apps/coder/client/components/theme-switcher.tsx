import { useState } from "react";
import { Icon } from "~/components/icon";
import { ThemeCard } from "~/components/theme-card";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { themeList } from "~/helpers/themes";
import { useThemeState } from "~/hooks/use-theme";

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const { setTheme, theme } = useThemeState();

  const darkThemes = themeList.filter((t) => t.type === "dark");
  const lightThemes = themeList.filter((t) => t.type === "light");

  const handleThemeSelect = (themeId: string) => {
    setTheme(themeId);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="size-7" size="icon" variant="ghost">
          {theme.type === "dark" ? (
            <Icon className="size-4" name="lucide:moon" />
          ) : (
            <Icon className="size-4" name="lucide:sun" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-card w-full overflow-y-auto sm:max-w-lg" side="right">
        <SheetHeader>
          <SheetTitle>Theme</SheetTitle>
          <SheetDescription>Customize the appearance of your editor</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          {/* Dark Themes */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Icon className="text-muted-foreground size-4" name="lucide:moon" />
              <h3 className="text-sm font-medium">Dark Themes</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {darkThemes.map((t) => (
                <ThemeCard
                  key={t.id}
                  colors={t.colors}
                  isSelected={theme.id === t.id}
                  name={t.name}
                  type={t.type}
                  onClick={() => handleThemeSelect(t.id)}
                />
              ))}
            </div>
          </div>

          {/* Light Themes */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Icon className="text-muted-foreground size-4" name="lucide:sun" />
              <h3 className="text-sm font-medium">Light Themes</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {lightThemes.map((t) => (
                <ThemeCard
                  key={t.id}
                  colors={t.colors}
                  isSelected={theme.id === t.id}
                  name={t.name}
                  type={t.type}
                  onClick={() => handleThemeSelect(t.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

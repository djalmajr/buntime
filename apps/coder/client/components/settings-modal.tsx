import { useState } from "react";
import { Icon } from "~/components/icon";
import { ThemeCard } from "~/components/theme-card";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { type AppearanceMode, useAppearance } from "~/hooks/use-appearance";
import { useEditorTheme } from "~/hooks/use-editor-theme";
import { cn } from "~/libs/cn";
import { themeList } from "~/libs/themes";

type SettingsSection = "appearance" | "editor" | "notifications" | "preferences";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface NavItemProps {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}

function NavItem({ active, icon, label, onClick }: NavItemProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      type="button"
      onClick={onClick}
    >
      <Icon className="size-4" name={icon} />
      <span>{label}</span>
    </button>
  );
}

interface AppearanceOptionProps {
  description: string;
  icon: string;
  isSelected: boolean;
  label: string;
  onClick: () => void;
}

function AppearanceOption({ description, icon, isSelected, label, onClick }: AppearanceOptionProps) {
  return (
    <button
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border-2 p-6 transition-all hover:scale-[1.02]",
        isSelected ? "border-primary ring-primary/20 ring-2" : "border-border hover:border-primary/50",
      )}
      type="button"
      onClick={onClick}
    >
      <Icon className={cn("size-8", isSelected ? "text-primary" : "text-muted-foreground")} name={icon} />
      <div className="text-center">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </button>
  );
}

function AppearanceSection() {
  const { mode, setMode } = useAppearance();

  const options: { description: string; icon: string; label: string; value: AppearanceMode }[] = [
    { description: "Always use light colors", icon: "lucide:sun", label: "Light", value: "light" },
    { description: "Always use dark colors", icon: "lucide:moon", label: "Dark", value: "dark" },
    { description: "Match system preference", icon: "lucide:monitor", label: "System", value: "system" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-muted-foreground text-sm">Choose how the application looks</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {options.map((option) => (
          <AppearanceOption
            key={option.value}
            description={option.description}
            icon={option.icon}
            isSelected={mode === option.value}
            label={option.label}
            onClick={() => setMode(option.value)}
          />
        ))}
      </div>
    </div>
  );
}

function EditorThemeSection() {
  const { setTheme, theme } = useEditorTheme();

  const darkThemes = themeList.filter((t) => t.type === "dark");
  const lightThemes = themeList.filter((t) => t.type === "light");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Editor Theme</h2>
        <p className="text-muted-foreground text-sm">Customize the syntax highlighting in the code editor</p>
      </div>

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
              onClick={() => setTheme(t.id)}
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
              onClick={() => setTheme(t.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreferencesSection() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Preferences</h2>
        <p className="text-muted-foreground text-sm">Customize your editor preferences</p>
      </div>

      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12">
        <Icon className="size-12 opacity-50" name="lucide:sliders-horizontal" />
        <p className="text-sm">Preferences settings coming soon</p>
      </div>
    </div>
  );
}

function NotificationsSection() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-muted-foreground text-sm">Configure how you receive notifications</p>
      </div>

      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12">
        <Icon className="size-12 opacity-50" name="lucide:bell" />
        <p className="text-sm">Notification settings coming soon</p>
      </div>
    </div>
  );
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");

  const renderContent = () => {
    switch (activeSection) {
      case "appearance":
        return <AppearanceSection />;
      case "editor":
        return <EditorThemeSection />;
      case "preferences":
        return <PreferencesSection />;
      case "notifications":
        return <NotificationsSection />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card flex h-[600px] max-h-[80vh] w-full max-w-3xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        {/* Sidebar */}
        <div className="bg-muted flex w-52 shrink-0 flex-col border-r p-4">
          <h2 className="mb-4 px-3 text-sm font-semibold">Settings</h2>
          <nav className="flex flex-col gap-1">
            <NavItem
              active={activeSection === "appearance"}
              icon="lucide:sun-moon"
              label="Appearance"
              onClick={() => setActiveSection("appearance")}
            />
            <NavItem
              active={activeSection === "editor"}
              icon="lucide:palette"
              label="Editor Theme"
              onClick={() => setActiveSection("editor")}
            />
            <NavItem
              active={activeSection === "preferences"}
              icon="lucide:sliders-horizontal"
              label="Preferences"
              onClick={() => setActiveSection("preferences")}
            />
            <NavItem
              active={activeSection === "notifications"}
              icon="lucide:bell"
              label="Notifications"
              onClick={() => setActiveSection("notifications")}
            />
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{renderContent()}</div>
      </DialogContent>
    </Dialog>
  );
}

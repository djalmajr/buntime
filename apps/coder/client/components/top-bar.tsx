import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "~/components/icon";
import { SettingsModal } from "~/components/settings-modal";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useAppearance } from "~/hooks/use-appearance";

const user = {
  avatar: "",
  email: "user@example.com",
  name: "Guest User",
};

const languages = [
  { code: "en", flag: "circle-flags:us", label: "English" },
  { code: "pt", flag: "circle-flags:br", label: "Portugues" },
];

function LanguageSwitcher() {
  const currentLang = languages[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="size-7" size="icon" variant="ghost">
          <Icon className="size-4" name={currentLang.flag} />
          <span className="sr-only">Change language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover w-40">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            className={lang.code === currentLang.code ? "bg-accent" : ""}
          >
            <Icon className="size-4" name={lang.flag} />
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppearanceToggle() {
  const { isDark, toggleMode } = useAppearance();

  return (
    <Button className="size-7" size="icon" variant="ghost" onClick={toggleMode}>
      {isDark ? (
        <Icon className="size-4 text-white/80" name="lucide:moon" />
      ) : (
        <Icon className="size-4 text-white/80" name="lucide:sun" />
      )}
      <span className="sr-only">Toggle appearance</span>
    </Button>
  );
}

interface UserMenuProps {
  onOpenSettings: () => void;
}

function UserMenu({ onOpenSettings }: UserMenuProps) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="size-7 p-0" size="icon" variant="ghost">
          <Avatar className="size-6">
            <AvatarImage alt={user.name} src={user.avatar} />
            <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover w-56">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="size-8">
              <AvatarImage alt={user.name} src={user.avatar} />
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="text-muted-foreground truncate text-xs">{user.email}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Icon name="lucide:user" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenSettings}>
          <Icon name="lucide:settings" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">
          <Icon name="lucide:log-out" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="relative z-50 flex h-10 w-full shrink-0 items-center justify-between bg-[#1a1a1a] px-3 shadow-md">
        {/* Left section: Logo + App name */}
        <Link className="flex items-center gap-2 transition-opacity hover:opacity-80" to="/">
          <Icon className="size-5 text-blue-500" name="lucide:zap" />
          <span className="text-sm font-medium text-white/90">Buntime</span>
        </Link>

        {/* Right section: Actions */}
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <AppearanceToggle />
          <UserMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </header>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

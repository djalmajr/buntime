import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Icon } from "./icon";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <Icon className="size-4" icon="lucide:circle-check" />,
        info: <Icon className="size-4" icon="lucide:info" />,
        warning: <Icon className="size-4" icon="lucide:triangle-alert" />,
        error: <Icon className="size-4" icon="lucide:octagon-x" />,
        loading: <Icon className="size-4 animate-spin" icon="lucide:loader-2" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Icon } from "~/components/icon";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        error: <Icon className="size-4" icon="lucide:octagon-x" />,
        info: <Icon className="size-4" icon="lucide:info" />,
        loading: <Icon className="size-4 animate-spin" icon="lucide:loader" />,
        success: <Icon className="size-4" icon="lucide:circle-check" />,
        warning: <Icon className="size-4" icon="lucide:triangle-alert" />,
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

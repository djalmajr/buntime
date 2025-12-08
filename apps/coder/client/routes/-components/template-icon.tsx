import { Icon } from "~/components/icon";
import type { TemplateId } from "~/libs/templates";

interface TemplateIconProps {
  className?: string;
  template: TemplateId;
}

export function TemplateIcon({ className, template }: TemplateIconProps) {
  switch (template) {
    case "react":
      return <Icon className={className} name="lucide:atom" />;
    case "vue":
      return <Icon className={className} name="lucide:hexagon" />;
    case "blank":
      return <Icon className={className} name="lucide:file-code" />;
  }
}

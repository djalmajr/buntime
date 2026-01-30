import { Icon as IconifyIcon } from "@iconify-icon/react";
import { createContext, type ReactNode, type SVGProps, useContext } from "react";

export interface IconData {
  body: string;
  height: number;
  width: number;
}

export type IconRegistry = Record<string, IconData>;

const IconRegistryContext = createContext<IconRegistry | null>(null);

export interface IconProviderProps {
  children: ReactNode;
  registry: IconRegistry;
}

export function IconProvider({ children, registry }: IconProviderProps) {
  return <IconRegistryContext.Provider value={registry}>{children}</IconRegistryContext.Provider>;
}

export function useIconRegistry(): IconRegistry | null {
  return useContext(IconRegistryContext);
}

export type IconProps = SVGProps<SVGSVGElement> & {
  icon: string | IconData;
};

/**
 * Icon component that renders SVG icons.
 *
 * - Uses static registry from IconProvider when available (build-time collected)
 * - Falls back to @iconify-icon/react for dynamic icons not in registry
 *
 * Safe: iconData.body contains pre-sanitized SVG paths from @iconify/json
 */
export function Icon({ icon, className, ...props }: IconProps) {
  const registry = useIconRegistry();

  // If icon is an IconData object, render directly (safe: pre-sanitized from @iconify/json)
  if (typeof icon !== "string") {
    const innerHTML = { __html: icon.body };
    return (
      <svg
        aria-hidden="true"
        className={className}
        dangerouslySetInnerHTML={innerHTML}
        height="1em"
        viewBox={`0 0 ${icon.width} ${icon.height}`}
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      />
    );
  }

  // Check static registry first (build-time collected icons)
  const iconData = registry?.[icon];

  if (iconData) {
    const innerHTML = { __html: iconData.body };
    return (
      <svg
        aria-hidden="true"
        className={className}
        dangerouslySetInnerHTML={innerHTML}
        height="1em"
        viewBox={`0 0 ${iconData.width} ${iconData.height}`}
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      />
    );
  }

  // Fallback to dynamic iconify-icon for icons not in registry
  return <IconifyIcon className={className} icon={icon} />;
}

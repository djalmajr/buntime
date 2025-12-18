/**
 * Type declarations for fragment web components
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

interface FragmentHostAttributes {
  /** Source URL (same as outlet's src) */
  src: string;
}

interface FragmentOutletAttributes {
  /** Source URL to fetch fragment from (required) */
  src: string;
  /** Shell's base path for routing context */
  base?: string;
  /** History isolation strategy: "patch" (History API interception) or "isolate" (iframe) */
  history?: "patch" | "isolate";
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "fragment-host": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & FragmentHostAttributes,
        HTMLElement
      >;
      "fragment-outlet": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & FragmentOutletAttributes,
        HTMLElement
      >;
    }
  }
}

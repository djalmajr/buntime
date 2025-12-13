/**
 * Type declarations for piercing web components
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "piercing-fragment-host": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { "fragment-id": string },
        HTMLElement
      >;
      "piercing-fragment-outlet": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { "fragment-id": string },
        HTMLElement
      >;
    }
  }
}

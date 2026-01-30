/**
 * Type declarations for z-frame web component
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

interface ZFrameAttributes {
  /** Current pathname to sync with frame */
  pathname?: string;
  /** Sandbox permissions for the iframe */
  sandbox?: string;
  /** Source URL to load in the iframe (required) */
  src: string;
  /** Emit a route-change event to the iframe */
  emit?: (event: string, detail: unknown) => void;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "z-frame": DetailedHTMLProps<HTMLAttributes<HTMLElement> & ZFrameAttributes, HTMLElement>;
    }
  }
}

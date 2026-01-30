/**
 * Type declarations for z-frame web component
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

interface ZFrameAttributes {
  /** Base path for routing (required) */
  base: string;
  /** Source URL to load in the iframe */
  src: string;
  /** Current pathname to sync with frame */
  pathname?: string;
  /** Sandbox permissions for the iframe */
  sandbox?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "z-frame": DetailedHTMLProps<HTMLAttributes<HTMLElement> & ZFrameAttributes, HTMLElement>;
    }
  }
}

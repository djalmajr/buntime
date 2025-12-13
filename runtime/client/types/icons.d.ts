declare module "~icons/*" {
  import type { SVGProps } from "react";
  const component: (props: SVGProps<SVGSVGElement>) => JSX.Element;
  export default component;
}

declare module "virtual:icons" {
  interface IconData {
    body: string;
    height: number;
    width: number;
  }
  export const registry: Record<string, IconData>;
}

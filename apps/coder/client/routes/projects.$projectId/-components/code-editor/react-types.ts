// Minimal React type definitions for Monaco editor
// These provide basic autocomplete and type checking in the sandbox environment

export const REACT_TYPES = `
declare module "react" {
  export function useState<T>(initialState: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T;
  export function useMemo<T>(factory: () => T, deps: any[]): T;
  export function useRef<T>(initialValue: T): { current: T };
  export function useContext<T>(context: React.Context<T>): T;
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initialState: S): [S, (action: A) => void];
  export function memo<T extends React.ComponentType<any>>(component: T): T;
  export function forwardRef<T, P>(render: (props: P, ref: React.Ref<T>) => React.ReactElement | null): React.ForwardRefExoticComponent<P & React.RefAttributes<T>>;
  export function createContext<T>(defaultValue: T): React.Context<T>;
  export function lazy<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>): React.LazyExoticComponent<T>;
  export function Fragment(props: { children?: React.ReactNode }): React.ReactElement;
  export function Suspense(props: { children?: React.ReactNode; fallback?: React.ReactNode }): React.ReactElement;
  export function StrictMode(props: { children?: React.ReactNode }): React.ReactElement;

  export type FC<P = {}> = (props: P) => React.ReactElement | null;
  export type ReactNode = React.ReactElement | string | number | boolean | null | undefined | React.ReactNode[];
  export type ReactElement = any;
  export type ComponentType<P = {}> = React.FC<P> | (new (props: P) => React.Component<P>);
  export type Ref<T> = { current: T | null } | ((instance: T | null) => void) | null;
  export type RefAttributes<T> = { ref?: React.Ref<T> };
  export type Context<T> = { Provider: any; Consumer: any };
  export type ForwardRefExoticComponent<P> = React.FC<P>;
  export type LazyExoticComponent<T> = React.FC<any>;
  export type PropsWithChildren<P = {}> = P & { children?: React.ReactNode };
  export type CSSProperties = Record<string, string | number>;
  export type HTMLAttributes<T> = any;
  export type ButtonHTMLAttributes<T> = any;
  export type InputHTMLAttributes<T> = any;
  export type FormHTMLAttributes<T> = any;
  export type SVGProps<T> = any;
  export type MouseEvent<T = Element> = any;
  export type ChangeEvent<T = Element> = any;
  export type FormEvent<T = Element> = any;
  export type KeyboardEvent<T = Element> = any;
  export type FocusEvent<T = Element> = any;

  export class Component<P = {}, S = {}> {
    props: P;
    state: S;
    setState(state: Partial<S> | ((prevState: S) => Partial<S>)): void;
    render(): React.ReactNode;
  }
}

declare module "react-dom/client" {
  export function createRoot(container: Element | null): {
    render(element: React.ReactNode): void;
    unmount(): void;
  };
}

declare global {
  namespace JSX {
    interface Element extends React.ReactElement {}
    interface ElementClass extends React.Component<any> {}
    interface IntrinsicElements {
      [elemName: string]: any;
      a: any;
      abbr: any;
      address: any;
      area: any;
      article: any;
      aside: any;
      audio: any;
      b: any;
      base: any;
      bdi: any;
      bdo: any;
      blockquote: any;
      body: any;
      br: any;
      button: any;
      canvas: any;
      caption: any;
      cite: any;
      code: any;
      col: any;
      colgroup: any;
      data: any;
      datalist: any;
      dd: any;
      del: any;
      details: any;
      dfn: any;
      dialog: any;
      div: any;
      dl: any;
      dt: any;
      em: any;
      embed: any;
      fieldset: any;
      figcaption: any;
      figure: any;
      footer: any;
      form: any;
      h1: any;
      h2: any;
      h3: any;
      h4: any;
      h5: any;
      h6: any;
      head: any;
      header: any;
      hgroup: any;
      hr: any;
      html: any;
      i: any;
      iframe: any;
      img: any;
      input: any;
      ins: any;
      kbd: any;
      label: any;
      legend: any;
      li: any;
      link: any;
      main: any;
      map: any;
      mark: any;
      menu: any;
      meta: any;
      meter: any;
      nav: any;
      noscript: any;
      object: any;
      ol: any;
      optgroup: any;
      option: any;
      output: any;
      p: any;
      picture: any;
      pre: any;
      progress: any;
      q: any;
      rp: any;
      rt: any;
      ruby: any;
      s: any;
      samp: any;
      script: any;
      section: any;
      select: any;
      slot: any;
      small: any;
      source: any;
      span: any;
      strong: any;
      style: any;
      sub: any;
      summary: any;
      sup: any;
      table: any;
      tbody: any;
      td: any;
      template: any;
      textarea: any;
      tfoot: any;
      th: any;
      thead: any;
      time: any;
      title: any;
      tr: any;
      track: any;
      u: any;
      ul: any;
      var: any;
      video: any;
      wbr: any;
      svg: any;
      path: any;
      circle: any;
      rect: any;
      line: any;
      polyline: any;
      polygon: any;
      ellipse: any;
      g: any;
      defs: any;
      use: any;
      text: any;
      tspan: any;
    }
  }
}

export {};
`;

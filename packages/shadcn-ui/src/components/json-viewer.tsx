import type { JsonViewProps } from "@uiw/react-json-view";
import JsonView from "@uiw/react-json-view";

export function JsonViewer(props: JsonViewProps<object>) {
  return (
    <JsonView {...props}>
      <JsonView.Colon
        render={(colonProps, { parentValue }) => {
          const noProps = Array.isArray(parentValue) && colonProps.children === ":";
          return noProps ? <span /> : <span {...colonProps} />;
        }}
      />
      <JsonView.KeyName
        render={(keyProps, { parentValue }) => {
          const noProps = Array.isArray(parentValue) && Number.isFinite(keyProps.children);
          return noProps ? <span /> : <span key={keyProps.key} {...keyProps} />;
        }}
      />
      <JsonView.Null render={() => <span>null</span>} />
    </JsonView>
  );
}

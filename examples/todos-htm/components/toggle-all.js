import { html } from "htm/preact";
import style from "./toggle-all.css" with { type: "css" };

document.adoptedStyleSheets.push(style);

export const ToggleAll = ({ allDone, isEmpty, onChange }) => {
  if (isEmpty) {
    return html``;
  }

  return html`
    <input
      id="toggle-all"
      type="checkbox"
      class=${`toggle-all ${allDone && "toggle-all--checked"}`}
      checked=${allDone}
      onchange=${onChange}
    />
    <label for="toggle-all">Mark all as complete</label>
  `;
};

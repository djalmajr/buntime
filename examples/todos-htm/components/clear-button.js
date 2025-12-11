import { html } from "htm/preact";
import style from "./clear-button.css" with { type: "css" };

document.adoptedStyleSheets.push(style);

export const ClearButton = ({ isEmpty, onClick }) => {
  if (isEmpty) {
    return html``;
  }

  return html`
    <button class="clear-button" onclick=${onClick}>
      Clear completed
    </button>
  `;
};

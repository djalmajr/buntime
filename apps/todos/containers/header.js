import { html } from "htm/preact";
import { connect } from "unistore/preact";
import { ToggleAll } from "../components/toggle-all.js";
import { actions } from "../store/actions.js";
import { getAllDone, getFiltered } from "../store/selectors.js";
import style from "./header.css" with { type: "css" };

document.adoptedStyleSheets.push(style);

const mapStateToProps = (state) => ({
  allDone: getAllDone(state),
  filtered: getFiltered(state),
});

export const Header = connect(
  mapStateToProps,
  actions,
)((props) => {
  const { addTodo, allDone, filtered, toggleAllTodos } = props;

  const handleAdd = (evt) => {
    const text = evt.target.value.trim();

    if (evt.key === "Enter" && text) {
      evt.target.value = "";
      addTodo(text);
    }
  };

  return html`
    <header class="header">
      <h1 class="header__title">todos</h1>
      <${ToggleAll}
        allDone=${allDone}
        isEmpty=${!filtered.length}
        onChange=${() => toggleAllTodos()}
      />
      <input
        autofocus
        class="header__input"
        placeholder="What needs to be done?"
        onkeypress=${handleAdd}
      />
    </header>
  `;
});

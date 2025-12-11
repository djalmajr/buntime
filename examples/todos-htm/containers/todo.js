import cn from "classnames";
import { html } from "htm/preact";
import { useRef, useState } from "preact/hooks";
import { connect } from "unistore/preact";
import { actions } from "../store/actions.js";
import style from "./todo.css" with { type: "css" };

document.adoptedStyleSheets.push(style);

export const Todo = connect(
  null,
  actions,
)((props) => {
  const { editTodo, removeTodo, todo, toggleTodo } = props;
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  const handleDblClick = () => {
    setEditing(true);
    setTimeout(() => inputRef.current.select());
  };

  const handleKeyUp = (evt) => {
    const text = evt.target.value.trim();

    if (evt.key === "Enter" && text) {
      editTodo({ ...todo, text });
      setEditing(false);
    } else if (evt.key === "Escape") {
      setEditing(false);
    }
  };

  return html`
    <li
      class=${cn("todo", {
        "todo--completed": todo.completed,
        "todo--editing": editing,
      })}
    >
      <div class="todo__view">
        <input
          type="checkbox"
          class="todo__toggle"
          checked=${todo.completed}
          onchange=${() => toggleTodo(todo)}
        />
        <label ondblclick=${handleDblClick}>${todo.text}</label>
        <button class="todo__destroy" onclick=${() => removeTodo(todo)} />
      </div>
      <input
        ref=${inputRef}
        class="todo__edit"
        value=${todo.text}
        onblur=${() => setEditing(false)}
        onkeyup=${handleKeyUp}
      />
    </li>
  `;
});

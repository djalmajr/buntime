import { clsx } from "clsx";
import { type KeyboardEvent, useRef, useState } from "react";
import type { Todo as TodoType } from "~/types";
import "./todo.css";

interface TodoProps {
  todo: TodoType;
  onEdit: (uid: string, text: string) => void;
  onRemove: (uid: string) => void;
  onToggle: (uid: string) => void;
}

export function Todo({ todo, onEdit, onRemove, onToggle }: TodoProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDblClick = () => {
    setEditing(true);
    setTimeout(() => inputRef.current?.select());
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
    const text = e.currentTarget.value.trim();

    if (e.key === "Enter" && text) {
      onEdit(todo.uid, text);
      setEditing(false);
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  };

  return (
    <li className={clsx("todo", todo.completed && "todo--completed", editing && "todo--editing")}>
      <div className="todo__view">
        <input
          type="checkbox"
          className="todo__toggle"
          checked={todo.completed}
          onChange={() => onToggle(todo.uid)}
        />
        {/* biome-ignore lint/a11y/noLabelWithoutControl: TodoMVC pattern - label styled via sibling selector, double-click to edit */}
        <label onDoubleClick={handleDblClick}>{todo.text}</label>
        <button
          type="button"
          aria-label="Delete todo"
          className="todo__destroy"
          onClick={() => onRemove(todo.uid)}
        />
      </div>
      <input
        ref={inputRef}
        className="todo__edit"
        defaultValue={todo.text}
        onBlur={() => setEditing(false)}
        onKeyUp={handleKeyUp}
      />
    </li>
  );
}

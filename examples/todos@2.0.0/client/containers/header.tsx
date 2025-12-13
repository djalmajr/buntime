import { type KeyboardEvent, useEffect, useRef } from "react";
import { ToggleAll } from "~/components/toggle-all";
import "./header.css";

interface HeaderProps {
  allDone: boolean;
  isEmpty: boolean;
  onAdd: (text: string) => void;
  onToggleAll: () => void;
}

export function Header({ allDone, isEmpty, onAdd, onToggleAll }: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAdd = (e: KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const text = input.value.trim();

    if (e.key === "Enter" && text) {
      input.value = "";
      onAdd(text);
    }
  };

  return (
    <header className="relative">
      <h1 className="header__title">todos</h1>
      <ToggleAll allDone={allDone} isEmpty={isEmpty} onChange={onToggleAll} />
      <input
        ref={inputRef}
        className="header__input"
        placeholder="What needs to be done?"
        onKeyDown={handleAdd}
      />
    </header>
  );
}

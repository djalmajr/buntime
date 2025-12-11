import { clsx } from "clsx";
import "./toggle-all.css";

interface ToggleAllProps {
  allDone: boolean;
  isEmpty: boolean;
  onChange: () => void;
}

export function ToggleAll({ allDone, isEmpty, onChange }: ToggleAllProps) {
  if (isEmpty) {
    return null;
  }

  return (
    <>
      <input
        id="toggle-all"
        type="checkbox"
        className={clsx("toggle-all", allDone && "toggle-all--checked")}
        checked={allDone}
        onChange={onChange}
      />
      <label htmlFor="toggle-all">Mark all as complete</label>
    </>
  );
}

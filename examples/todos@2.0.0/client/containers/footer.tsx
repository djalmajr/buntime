import { clsx } from "clsx";
import { ClearButton } from "~/components/clear-button";
import type { FilterType, Todo } from "~/types";
import "./footer.css";

interface FooterProps {
  all: Todo[];
  completed: Todo[];
  filter: FilterType;
  incompleted: Todo[];
  onClearCompleted: () => void;
}

export function Footer({ all, completed, filter, incompleted, onClearCompleted }: FooterProps) {
  const remaining = incompleted.length;

  if (!all.length) {
    return null;
  }

  return (
    <footer className="footer__container">
      <span className="footer__count">
        <strong>{remaining}</strong> {remaining === 1 ? "item" : "items"} left
      </span>
      <ul className="footer__filters">
        <li>
          <a href="#/all" className={clsx(filter === "all" && "selected")}>
            All
          </a>
        </li>
        <li>
          <a href="#/active" className={clsx(filter === "active" && "selected")}>
            Active
          </a>
        </li>
        <li>
          <a href="#/completed" className={clsx(filter === "completed" && "selected")}>
            Completed
          </a>
        </li>
      </ul>
      <ClearButton isEmpty={!completed.length} onClick={onClearCompleted} />
    </footer>
  );
}

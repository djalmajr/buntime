import "./clear-button.css";

interface ClearButtonProps {
  isEmpty: boolean;
  onClick: () => void;
}

export function ClearButton({ isEmpty, onClick }: ClearButtonProps) {
  if (isEmpty) {
    return null;
  }

  return (
    <button type="button" className="clear-button" onClick={onClick}>
      Clear completed
    </button>
  );
}

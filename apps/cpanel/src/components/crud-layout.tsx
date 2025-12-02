import { useEffect } from "react";
import { useHeader } from "~/contexts/header-context";

export interface CrudLayoutProps {
  addButtonLink?: string;
  addButtonText?: string;
  children: React.ReactNode;
  onAddItem?: () => void;
}

export function CrudLayout({ addButtonLink, addButtonText, children, onAddItem }: CrudLayoutProps) {
  const { setAction } = useHeader();

  useEffect(() => {
    if (addButtonText) {
      setAction({
        href: addButtonLink,
        label: addButtonText,
        onClick: onAddItem,
      });
    }

    return () => {
      setAction(null);
    };
  }, [addButtonText, addButtonLink, onAddItem, setAction]);

  return <div className="flex flex-1 flex-col gap-4 overflow-hidden">{children}</div>;
}

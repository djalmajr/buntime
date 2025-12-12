import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { useHeader } from "~/contexts/header-context";

export interface CrudLayoutProps {
  addButtonLink?: string;
  addButtonText?: string;
  children: React.ReactNode;
  onAddItem?: () => void;
}

export function CrudLayout({ addButtonLink, addButtonText, children, onAddItem }: CrudLayoutProps) {
  const { setHeader } = useHeader();

  useEffect(() => {
    if (addButtonText) {
      setHeader({
        actions: (
          <Button asChild={!!addButtonLink} size="sm" onClick={onAddItem}>
            {addButtonLink ? (
              <Link to={addButtonLink}>
                <Icon className="size-4" icon="lucide:plus" />
                <span>{addButtonText}</span>
              </Link>
            ) : (
              <>
                <Icon className="size-4" icon="lucide:plus" />
                <span>{addButtonText}</span>
              </>
            )}
          </Button>
        ),
      });
    }

    return () => {
      setHeader(null);
    };
  }, [addButtonText, addButtonLink, onAddItem, setHeader]);

  return <div className="flex flex-1 flex-col gap-4 overflow-hidden">{children}</div>;
}

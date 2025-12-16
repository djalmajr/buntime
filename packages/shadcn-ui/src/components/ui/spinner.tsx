import { cn } from "../../utils/cn";
import { Icon } from "./icon";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Icon
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      icon="lucide:loader-2"
      role="status"
      {...props}
    />
  );
}

export { Spinner };

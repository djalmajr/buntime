import { useState } from "react";
import { cn } from "../../utils/cn";
import { Icon } from "./icon";

interface InputProps extends React.ComponentProps<"input"> {
  /** Transforms internal value to display format */
  formatter?: (value: string) => string;
  /** Transforms user input back to internal format */
  parser?: (value: string) => string;
}

function Input({ className, formatter, onChange, parser, type, value, ...props }: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  const displayValue = formatter ? formatter(String(value ?? "")) : value;

  const handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    if (!onChange) return;

    if (parser) {
      const parsedValue = parser(evt.target.value);
      const syntheticEvent = {
        ...evt,
        target: { ...evt.target, value: parsedValue },
        currentTarget: { ...evt.currentTarget, value: parsedValue },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    } else {
      onChange(evt);
    }
  };

  const inputElement = (
    <input
      type={isPassword && showPassword ? "text" : type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        isPassword && "pr-10",
        className,
      )}
      value={displayValue}
      onChange={handleChange}
      {...props}
    />
  );

  if (!isPassword) {
    return inputElement;
  }

  return (
    <div className="relative">
      {inputElement}
      <button
        className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
        tabIndex={-1}
        type="button"
        onClick={() => setShowPassword(!showPassword)}
      >
        {showPassword ? (
          <Icon className="size-4" icon="lucide:eye-off" />
        ) : (
          <Icon className="size-4" icon="lucide:eye" />
        )}
      </button>
    </div>
  );
}

export { Input };

import React from "react";

/** MD3 Outlined Text Field：无效态整组替换边框与聚焦环，避免同级工具类互相覆盖。 */
function fieldTone(invalid?: boolean): string {
  return invalid
    ? "border-error focus:border-error focus:ring-1 focus:ring-error"
    : "border-outline focus:border-primary focus:ring-1 focus:ring-primary";
}

const FIELD_BASE =
  "w-full rounded-sm border bg-surface-container-lowest px-3 py-2 text-body-medium text-on-surface placeholder:text-on-surface-variant transition-colors focus:outline-none disabled:opacity-[0.38] disabled:cursor-not-allowed";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${FIELD_BASE} ${fieldTone(invalid)} ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, className = "", ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${FIELD_BASE} ${fieldTone(invalid)} ${className}`}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ invalid, className = "", children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${FIELD_BASE} ${fieldTone(invalid)} ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";

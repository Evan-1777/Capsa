import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`w-full rounded border bg-surface text-foreground text-body px-3 py-1.5 transition-colors focus:outline-none focus:border-brand focus-visible:ring-1 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${
          invalid ? "border-danger focus:border-danger focus-visible:ring-danger" : "border-stroke"
        } ${className}`}
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
        className={`w-full rounded border bg-surface text-foreground text-body px-3 py-1.5 transition-colors focus:outline-none focus:border-brand focus-visible:ring-1 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${
          invalid ? "border-danger focus:border-danger focus-visible:ring-danger" : "border-stroke"
        } ${className}`}
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
        className={`w-full rounded border bg-surface text-foreground text-body px-3 py-1.5 transition-colors focus:outline-none focus:border-brand focus-visible:ring-1 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${
          invalid ? "border-danger focus:border-danger focus-visible:ring-danger" : "border-stroke"
        } ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";
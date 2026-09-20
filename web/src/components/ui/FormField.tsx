import React from "react";

export interface FormFieldProps {
  label: React.ReactNode;
  id?: string;
  counter?: {
    current: number;
    max: number;
    over: boolean;
  };
  error?: string | null;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  id,
  counter,
  error,
  hint,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <div className={`block space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-xs font-medium text-foreground">
        <label htmlFor={id} className="cursor-default">
          {label}
        </label>
        {counter && (
          <span
            aria-invalid={counter.over ? "true" : undefined}
            className={counter.over ? "text-danger font-semibold" : "text-subtle font-normal"}
          >
            {counter.current}/{counter.max}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

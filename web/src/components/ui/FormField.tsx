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
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="cursor-default text-label-large text-on-surface">
          {label}
        </label>
        {counter && (
          <span
            aria-invalid={counter.over ? "true" : undefined}
            className={`text-label-medium ${
              counter.over ? "font-semibold text-error" : "text-on-surface-variant"
            }`}
          >
            {counter.current}/{counter.max}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-body-small text-on-surface-variant">{hint}</p>}
      {error && (
        <p role="alert" className="text-body-small text-error">
          {error}
        </p>
      )}
    </div>
  );
}

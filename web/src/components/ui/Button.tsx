import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "subtle" | "danger" | "warning";
  size?: "sm" | "md";
  busy?: boolean;
  busyText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      busy = false,
      busyText,
      disabled,
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    const base =
      "inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

    const sizes = {
      sm: "px-2.5 py-1 text-xs rounded",
      md: "px-3.5 py-1.5 text-sm rounded",
    };

    const variants = {
      primary: "bg-brand text-white hover:bg-brand-hover active:bg-brand-pressed border border-transparent",
      secondary: "bg-surface text-foreground border border-stroke hover:bg-background active:bg-surface",
      subtle: "bg-transparent text-foreground hover:bg-surface/80 active:bg-surface border border-transparent",
      danger: "bg-danger text-white hover:bg-danger-hover active:bg-danger-pressed border border-transparent",
      warning: "bg-warning text-white hover:opacity-90 active:opacity-80 border border-transparent",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {busy && busyText ? busyText : children}
      </button>
    );
  },
);
Button.displayName = "Button";

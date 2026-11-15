import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "tonal" | "secondary" | "text" | "danger" | "warning";
  size?: "sm" | "md";
  busy?: boolean;
  busyText?: string;
}

const BASE =
  "md-state-layer inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-[0.38] disabled:cursor-not-allowed";

const SIZES = {
  sm: "h-8 px-4 text-label-large",
  md: "h-10 px-6 text-label-large",
};

const VARIANTS = {
  primary: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  secondary: "border border-outline bg-transparent text-on-surface",
  text: "bg-transparent text-primary",
  danger: "bg-error text-on-error",
  warning: "bg-warning-container text-on-warning-container",
};

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
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
        {...props}
      >
        {busy && busyText ? busyText : children}
      </button>
    );
  },
);
Button.displayName = "Button";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** standard 为纯图标；tonal 为带填充的图标按钮。 */
  variant?: "standard" | "tonal";
  /** 切换态：选中时套用 secondary-container 并透出 aria-pressed。 */
  selected?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "standard", selected = false, className = "", children, ...props }, ref) => {
    const tone = selected
      ? "bg-secondary-container text-on-secondary-container"
      : variant === "tonal"
        ? "bg-surface-container-highest text-on-surface-variant"
        : "text-on-surface-variant";

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected || undefined}
        className={`md-state-layer inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-[0.38] disabled:cursor-not-allowed ${tone} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";

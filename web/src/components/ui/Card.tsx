import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "section" | "ul" | "ol" | "li";
  variant?: "outlined" | "filled";
}

const VARIANTS = {
  outlined: "border border-outline-variant bg-surface-container-low",
  filled: "bg-surface-container",
};

export const Card = React.forwardRef<HTMLElement, CardProps>(
  ({ as: Component = "div", variant = "outlined", className = "", children, ...props }, ref) => {
    return (
      <Component
        ref={ref as never}
        className={`rounded-md text-on-surface ${VARIANTS[variant]} ${className}`}
        {...(props as object)}
      >
        {children}
      </Component>
    );
  },
);
Card.displayName = "Card";

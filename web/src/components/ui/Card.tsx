import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "article" | "ul" | "ol" | "li";
}

export const Card = React.forwardRef<HTMLElement, CardProps>(
  ({ as: Component = "div", className = "", children, ...props }, ref) => {
    return (
      <Component
        ref={ref as never}
        className={`rounded-md border border-stroke bg-surface text-foreground shadow-card transition-colors ${className}`}
        {...(props as object)}
      >
        {children}
      </Component>
    );
  },
);
Card.displayName = "Card";

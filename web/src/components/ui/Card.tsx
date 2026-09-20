import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "article" | "li";
  clickable?: boolean;
  selected?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ as: Component = "div", clickable = false, selected = false, className = "", children, ...props }, ref) => {
    return (
      <Component
        ref={ref as never}
        className={`rounded-md border bg-surface text-foreground shadow-card transition-colors ${
          selected
            ? "border-brand ring-1 ring-brand"
            : "border-stroke"
        } ${
          clickable
            ? "cursor-pointer hover:border-stroke-strong hover:bg-surface/90"
            : ""
        } ${className}`}
        {...(props as object)}
      >
        {children}
      </Component>
    );
  },
);
Card.displayName = "Card";

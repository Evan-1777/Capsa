import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "brand" | "success" | "warning" | "danger";
}

export function Badge({ variant = "neutral", className = "", children, ...props }: BadgeProps) {
  const variants = {
    neutral: "bg-surface text-muted border-stroke",
    brand: "bg-brand/10 text-brand border-brand/20",
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    danger: "bg-danger/10 text-danger border-danger/20",
  };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-caption font-medium border ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

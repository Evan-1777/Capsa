/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        acrylic: "var(--color-acrylic)",
        stroke: "var(--color-stroke)",
        foreground: "var(--color-foreground)",
        "fill-foreground": "var(--color-fill-foreground)",
        muted: "var(--color-muted)",
        subtle: "var(--color-subtle)",
        brand: {
          DEFAULT: "var(--color-brand)",
          hover: "var(--color-brand-hover)",
          pressed: "var(--color-brand-pressed)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover: "var(--color-danger-hover)",
          pressed: "var(--color-danger-pressed)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
        },
        success: {
          DEFAULT: "var(--color-success)",
        },
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        dialog: "var(--shadow-dialog)",
      },
      transitionDuration: {
        normal: "250ms",
      },
      transitionTimingFunction: {
        fluent: "cubic-bezier(0.1, 0.9, 0.2, 1)",
      },
      fontFamily: {
        sans: ["Segoe UI", "-apple-system", "BlinkMacSystemFont", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "system-ui", "Roboto", "Helvetica Neue", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

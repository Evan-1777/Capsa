/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--md-sys-color-primary)",
        "on-primary": "var(--md-sys-color-on-primary)",
        "primary-container": "var(--md-sys-color-primary-container)",
        "on-primary-container": "var(--md-sys-color-on-primary-container)",
        secondary: "var(--md-sys-color-secondary)",
        "on-secondary": "var(--md-sys-color-on-secondary)",
        "secondary-container": "var(--md-sys-color-secondary-container)",
        "on-secondary-container": "var(--md-sys-color-on-secondary-container)",
        error: "var(--md-sys-color-error)",
        "on-error": "var(--md-sys-color-on-error)",
        "error-container": "var(--md-sys-color-error-container)",
        "on-error-container": "var(--md-sys-color-on-error-container)",
        warning: "var(--md-sys-color-warning)",
        "on-warning": "var(--md-sys-color-on-warning)",
        "warning-container": "var(--md-sys-color-warning-container)",
        "on-warning-container": "var(--md-sys-color-on-warning-container)",
        success: "var(--md-sys-color-success)",
        "on-success": "var(--md-sys-color-on-success)",
        "success-container": "var(--md-sys-color-success-container)",
        "on-success-container": "var(--md-sys-color-on-success-container)",
        surface: "var(--md-sys-color-surface)",
        "on-surface": "var(--md-sys-color-on-surface)",
        "on-surface-variant": "var(--md-sys-color-on-surface-variant)",
        "surface-container-lowest": "var(--md-sys-color-surface-container-lowest)",
        "surface-container-low": "var(--md-sys-color-surface-container-low)",
        "surface-container": "var(--md-sys-color-surface-container)",
        "surface-container-high": "var(--md-sys-color-surface-container-high)",
        "surface-container-highest": "var(--md-sys-color-surface-container-highest)",
        outline: "var(--md-sys-color-outline)",
        "outline-variant": "var(--md-sys-color-outline-variant)",
        scrim: "var(--md-sys-color-scrim)",
      },
      borderRadius: {
        none: "var(--md-sys-shape-corner-none)",
        xs: "var(--md-sys-shape-corner-extra-small)",
        sm: "var(--md-sys-shape-corner-small)",
        md: "var(--md-sys-shape-corner-medium)",
        lg: "var(--md-sys-shape-corner-large)",
        xl: "var(--md-sys-shape-corner-extra-large)",
        full: "var(--md-sys-shape-corner-full)",
      },
      boxShadow: {
        "elevation-3": "var(--md-sys-elevation-3)",
      },
      transitionTimingFunction: {
        standard: "var(--md-sys-motion-easing-standard)",
        "emphasized-decelerate": "var(--md-sys-motion-easing-emphasized-decelerate)",
      },
      fontFamily: {
        sans: [
          "Roboto",
          "Noto Sans SC",
          "PingFang SC",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "headline-small": [
          "var(--md-sys-typescale-headline-small-size)",
          { lineHeight: "var(--md-sys-typescale-headline-small-line-height)" },
        ],
        "title-large": [
          "var(--md-sys-typescale-title-large-size)",
          { lineHeight: "var(--md-sys-typescale-title-large-line-height)" },
        ],
        "title-medium": [
          "var(--md-sys-typescale-title-medium-size)",
          {
            lineHeight: "var(--md-sys-typescale-title-medium-line-height)",
            fontWeight: "500",
          },
        ],
        "title-small": [
          "var(--md-sys-typescale-title-small-size)",
          { lineHeight: "var(--md-sys-typescale-title-small-line-height)", fontWeight: "500" },
        ],
        "body-large": [
          "var(--md-sys-typescale-body-large-size)",
          { lineHeight: "var(--md-sys-typescale-body-large-line-height)" },
        ],
        "body-medium": [
          "var(--md-sys-typescale-body-medium-size)",
          { lineHeight: "var(--md-sys-typescale-body-medium-line-height)" },
        ],
        "body-small": [
          "var(--md-sys-typescale-body-small-size)",
          { lineHeight: "var(--md-sys-typescale-body-small-line-height)" },
        ],
        "label-large": [
          "var(--md-sys-typescale-label-large-size)",
          { lineHeight: "var(--md-sys-typescale-label-large-line-height)", fontWeight: "500" },
        ],
        "label-medium": [
          "var(--md-sys-typescale-label-medium-size)",
          { lineHeight: "var(--md-sys-typescale-label-medium-line-height)", fontWeight: "500" },
        ],
        "label-small": [
          "var(--md-sys-typescale-label-small-size)",
          { lineHeight: "var(--md-sys-typescale-label-small-line-height)", fontWeight: "500" },
        ],
      },
    },
  },
  plugins: [],
};

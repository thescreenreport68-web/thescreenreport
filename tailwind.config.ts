import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#16203F",
          900: "#0F1730",
          800: "#16203F",
          700: "#22305A",
        },
        gold: {
          DEFAULT: "#C8A24A",
          600: "#B68F34",
        },
        breaking: "#B11226",
        ink: "#14110F",
        ink2: "#23201D",
        slate: "#4A5267",
        faint: "#707A93",
        hair: "#E2E5EC",
        mist: "#EEF1F7",
      },
      fontFamily: {
        // Fraunces (tuned SOFT 0 / WONK 0 in globals) — headlines, masthead, deks.
        display: ["var(--font-display)", "Georgia", "serif"],
        serif: ["var(--font-display)", "Georgia", "serif"],
        dek: ["var(--font-display)", "Georgia", "serif"],
        // Source Serif 4 — article body copy.
        body: ["var(--font-body)", "Georgia", "serif"],
        // Karla — labels, kickers, nav, bylines, UI.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        wide: "1280px",
        prose: "680px",
      },
      typography: () => ({
        screen: {
          css: {
            "--tw-prose-body": "#23201D",
            "--tw-prose-headings": "#16203F",
            "--tw-prose-links": "#16203F",
            "--tw-prose-bold": "#14110F",
            "--tw-prose-quotes": "#16203F",
            "--tw-prose-bullets": "#C8A24A",
            "--tw-prose-counters": "#B68F34",
            maxWidth: "680px",
            fontFamily: "var(--font-body), Georgia, serif",
            fontSize: "1.1875rem",
            lineHeight: "1.75",
            h2: {
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: "600",
              fontSize: "1.95rem",
              letterSpacing: "-0.01em",
              lineHeight: "1.18",
              marginTop: "1.9em",
              marginBottom: "0.55em",
            },
            h3: {
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: "600",
              fontSize: "1.45rem",
            },
            a: {
              textDecoration: "underline",
              textDecorationColor: "#C8A24A",
              textDecorationThickness: "1px",
              textUnderlineOffset: "3px",
              fontWeight: "600",
            },
            blockquote: {
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontWeight: "500",
              fontSize: "1.4rem",
              color: "#16203F",
              borderLeftWidth: "3px",
              borderLeftColor: "#C8A24A",
            },
            "li::marker": { color: "#C8A24A" },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

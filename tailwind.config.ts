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
        mist: "#EEF1F7",
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        wide: "1280px",
        prose: "720px",
      },
      typography: () => ({
        screen: {
          css: {
            "--tw-prose-body": "#14110F",
            "--tw-prose-headings": "#16203F",
            "--tw-prose-links": "#16203F",
            "--tw-prose-bold": "#14110F",
            "--tw-prose-quotes": "#16203F",
            "--tw-prose-bullets": "#C8A24A",
            "--tw-prose-counters": "#B68F34",
            maxWidth: "none",
            fontSize: "1.125rem",
            lineHeight: "1.75",
            h2: {
              fontFamily: "var(--font-fraunces), Georgia, serif",
              fontWeight: "600",
              letterSpacing: "-0.01em",
              marginTop: "2em",
            },
            h3: {
              fontFamily: "var(--font-fraunces), Georgia, serif",
              fontWeight: "600",
            },
            a: {
              textDecoration: "underline",
              textDecorationColor: "#C8A24A",
              textUnderlineOffset: "3px",
              fontWeight: "500",
            },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

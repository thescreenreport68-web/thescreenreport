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
        // THR palette: near-black ink + a bright red accent on white.
        // (Token names kept as navy/gold so existing classes recolor in place:
        //  navy = ink/black, gold = THR red.)
        navy: {
          DEFAULT: "#1A1A1A",
          900: "#0E0E0E",
          800: "#1A1A1A",
          700: "#3A3A3A",
        },
        gold: {
          DEFAULT: "#E0102B",
          600: "#C20E24",
        },
        breaking: "#E0102B",
        ink: "#0E0E0E",
        ink2: "#222222",
        slate: "#52525B",
        faint: "#71717A",
        hair: "#E4E4E7",
        mist: "#F4F4F5",
      },
      fontFamily: {
        display: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        serif: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        dek: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        wide: "1280px",
        prose: "680px",
      },
      typography: () => ({
        screen: {
          css: {
            "--tw-prose-body": "#222222",
            "--tw-prose-headings": "#1A1A1A",
            "--tw-prose-links": "#1A1A1A",
            "--tw-prose-bold": "#0E0E0E",
            "--tw-prose-quotes": "#1A1A1A",
            "--tw-prose-bullets": "#E0102B",
            "--tw-prose-counters": "#E0102B",
            maxWidth: "680px",
            fontFamily: "var(--font-body), Georgia, serif",
            fontSize: "1.1875rem",
            lineHeight: "1.75",
            h2: {
              fontFamily: '"kepler-std-semicondensed-dis", var(--font-display), Georgia, serif',
              fontWeight: "700",
              fontSize: "1.95rem",
              letterSpacing: "-0.01em",
              lineHeight: "1.18",
              marginTop: "1.9em",
              marginBottom: "0.55em",
            },
            h3: {
              fontFamily: '"kepler-std-semicondensed-dis", var(--font-display), Georgia, serif',
              fontWeight: "700",
              fontSize: "1.45rem",
            },
            a: {
              textDecoration: "underline",
              textDecorationColor: "#E0102B",
              textDecorationThickness: "1px",
              textUnderlineOffset: "3px",
              fontWeight: "600",
            },
            blockquote: {
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontWeight: "500",
              fontSize: "1.4rem",
              color: "#1A1A1A",
              borderLeftWidth: "3px",
              borderLeftColor: "#E0102B",
            },
            "li::marker": { color: "#E0102B" },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

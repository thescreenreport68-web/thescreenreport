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
        // THR ("Larva") tokens — token names kept as navy/gold so existing classes recolor.
        // navy = ink (#101010 / #000), gold = THR brand red (#D92128).
        navy: {
          DEFAULT: "#101010",
          900: "#000000",
          800: "#101010",
          700: "#3A3A3A",
        },
        gold: {
          DEFAULT: "#D92128",
          600: "#B81C22",
        },
        breaking: "#D92128",
        ink: "#000000",
        ink2: "#101010",
        slate: "#5A5A5A", // grey-dark: bylines, timestamps, dotted dividers
        faint: "#5A5A5A",
        grey: "#8C8C8C", // mid grey: solid section rules
        hair: "#DCDCDC", // grey-light: hairlines
        mist: "#EFEFEF", // grey-lightest: image placeholder bg
      },
      fontFamily: {
        // Kepler condensed display — hero headline + SECTION TITLES only.
        display: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        serif: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        dek: ["var(--font-display)", "Georgia", "serif"],
        // Source Serif 4 — stand-in for standard "kepler-std": ALL article/news/card headlines + body.
        body: ["var(--font-body)", "Georgia", "serif"],
        // Karla — labels, kickers, nav, bylines, timestamps.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        wide: "1160px",
        prose: "680px",
      },
      typography: () => ({
        screen: {
          css: {
            "--tw-prose-body": "#101010",
            "--tw-prose-headings": "#000000",
            "--tw-prose-links": "#101010",
            "--tw-prose-bold": "#000000",
            "--tw-prose-quotes": "#101010",
            "--tw-prose-bullets": "#D92128",
            "--tw-prose-counters": "#D92128",
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
              textDecorationColor: "#D92128",
              textDecorationThickness: "1px",
              textUnderlineOffset: "3px",
              fontWeight: "600",
            },
            blockquote: {
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontWeight: "500",
              fontSize: "1.4rem",
              color: "#101010",
              borderLeftWidth: "3px",
              borderLeftColor: "#D92128",
            },
            "li::marker": { color: "#D92128" },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

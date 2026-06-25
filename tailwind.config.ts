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
        navy: { DEFAULT: "#101010", 900: "#000000", 800: "#101010", 700: "#3A3A3A" },
        gold: { DEFAULT: "#D92128", 600: "#B81C22" },
        breaking: "#D92128",
        ink: "#000000",
        ink2: "#101010",
        slate: "#5A5A5A",
        faint: "#5A5A5A",
        grey: "#8C8C8C",
        hair: "#DCDCDC",
        mist: "#EFEFEF",
      },
      fontFamily: {
        display: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        serif: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        dek: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        wide: "1160px",
        prose: "660px",
      },
      typography: () => ({
        // THR article body: standard serif 22px/1.4, serif H2, Karla-sans H3,
        // red no-underline links, red pull-quotes.
        screen: {
          css: {
            "--tw-prose-body": "#101010",
            "--tw-prose-headings": "#101010",
            "--tw-prose-links": "#D92128",
            "--tw-prose-bold": "#000000",
            "--tw-prose-bullets": "#D92128",
            "--tw-prose-counters": "#5A5A5A",
            maxWidth: "660px",
            fontFamily: "var(--font-body), Georgia, serif",
            fontSize: "1.375rem",
            lineHeight: "1.42",
            p: { marginTop: "1rem", marginBottom: "0" },
            h2: {
              fontFamily: "var(--font-body), Georgia, serif",
              fontWeight: "400",
              fontSize: "2.375rem",
              lineHeight: "1.05",
              letterSpacing: "-0.005em",
              marginTop: "1.5em",
              marginBottom: "0.15em",
            },
            h3: {
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              fontWeight: "700",
              fontSize: "1.75rem",
              lineHeight: "1.1",
              letterSpacing: "-0.02em",
              marginTop: "1.5em",
              marginBottom: "0.2em",
            },
            a: { textDecoration: "none", color: "#D92128", fontWeight: "inherit" },
            "a:hover": { textDecoration: "underline" },
            blockquote: {
              fontFamily: "var(--font-body), Georgia, serif",
              fontStyle: "normal",
              fontWeight: "400",
              fontSize: "2rem",
              lineHeight: "1.15",
              color: "#D92128",
              borderLeftWidth: "0",
              paddingLeft: "0",
              marginTop: "1em",
              marginBottom: "1em",
            },
            "li::marker": { color: "#D92128" },
            "ul > li, ol > li": { marginTop: "0.25rem" },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

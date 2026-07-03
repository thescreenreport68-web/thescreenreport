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
        // ---- canonical palette (DESIGN_UPGRADE_SPEC.md §A1) ----
        paper: "#FFFFFF", // the only background
        ink: "#101010", // all text + 2px rules (never pure #000)
        red: { DEFAULT: "#D92128", dark: "#A31418" }, // the one accent + hover-darken
        charcoal: "#333333", // deks only — between ink and slate
        slate: "#5A5A5A", // secondary text, bylines, meta
        gray: "#8C8C8C", // dotted rules, mid hairlines, credits
        hair: "#DCDCDC", // light hairlines (workhorse border)
        mist: "#EFEFEF", // image-placeholder bg ONLY — never panel bg
        // ---- deprecated aliases (same values; migrate to the names above) ----
        navy: { DEFAULT: "#101010", 900: "#000000", 800: "#101010", 700: "#3A3A3A" },
        gold: { DEFAULT: "#D92128", 600: "#A31418" },
        breaking: "#D92128",
        ink2: "#101010",
        faint: "#5A5A5A",
        grey: "#8C8C8C",
      },
      fontFamily: {
        // 4 families, 4 roles (spec §A2)
        display: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Helvetica", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        // deprecated aliases
        serif: ['"kepler-std-semicondensed-dis"', "var(--font-display)", "Georgia", "serif"],
        dek: ["var(--font-body)", "Georgia", "serif"],
      },
      maxWidth: {
        wide: "1160px",
        prose: "660px",
      },
      typography: () => ({
        // Article body (spec §D7): Source Serif 19px/1.65 ink on a 660px measure;
        // Karla bold-in-serif (THR signature); condensed-display H2; hung-red pullquote;
        // ink-tinted underlined links that warm to red.
        screen: {
          css: {
            "--tw-prose-body": "#101010",
            "--tw-prose-headings": "#101010",
            "--tw-prose-links": "#101010",
            "--tw-prose-bold": "#101010",
            "--tw-prose-bullets": "#D92128",
            "--tw-prose-counters": "#5A5A5A",
            "--tw-prose-quotes": "#D92128",
            maxWidth: "660px",
            fontFamily: "var(--font-body), Georgia, serif",
            fontSize: "1.125rem",
            lineHeight: "1.6",
            "@media (min-width: 1024px)": {
              fontSize: "1.1875rem",
              lineHeight: "1.65",
            },
            p: { marginTop: "1.15em", marginBottom: "0" },
            strong: {
              fontFamily: "var(--font-sans), Helvetica, sans-serif",
              fontWeight: "700",
              fontSize: "0.9em",
              letterSpacing: "-0.01em",
            },
            h2: {
              fontFamily:
                '"kepler-std-semicondensed-dis", var(--font-display), Georgia, serif',
              fontWeight: "700",
              fontSize: "1.625rem",
              lineHeight: "1.1",
              letterSpacing: "-0.005em",
              marginTop: "2.2em",
              marginBottom: "0.4em",
            },
            h3: {
              fontFamily: "var(--font-sans), Helvetica, sans-serif",
              fontWeight: "700",
              fontSize: "1.1875rem",
              lineHeight: "1.25",
              letterSpacing: "-0.01em",
              marginTop: "1.8em",
              marginBottom: "0.35em",
            },
            a: {
              color: "#101010",
              fontWeight: "inherit",
              textDecoration: "underline",
              textDecorationThickness: "1px",
              textUnderlineOffset: "3px",
              textDecorationColor: "rgba(16, 16, 16, 0.3)",
              transitionProperty: "text-decoration-color, color",
              transitionDuration: "150ms",
            },
            "a:hover": { color: "#D92128", textDecorationColor: "#D92128" },
            blockquote: {
              fontFamily:
                '"kepler-std-semicondensed-dis", var(--font-display), Georgia, serif',
              fontStyle: "normal",
              fontWeight: "700",
              fontSize: "1.75rem",
              lineHeight: "1.1",
              letterSpacing: "-0.01em",
              color: "#D92128",
              borderLeftWidth: "0",
              paddingLeft: "0",
              paddingTop: "0.75em",
              paddingBottom: "0.75em",
              marginTop: "0.75em",
              marginBottom: "0.75em",
              quotes: "none",
              "@media (min-width: 1024px)": { fontSize: "2.125rem" },
            },
            "blockquote p:first-of-type::before": { content: "none" },
            "blockquote p:last-of-type::after": { content: "none" },
            "li::marker": { color: "#D92128" },
            "ul > li, ol > li": { marginTop: "0.35rem" },
            figcaption: {
              fontFamily: "var(--font-body), Georgia, serif",
              fontSize: "0.875rem",
              lineHeight: "1.35",
              color: "#101010",
            },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

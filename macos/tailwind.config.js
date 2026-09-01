/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        "surface-soft": "var(--cream-soft)",
        "surface-card": "var(--cream)",
        "cream-strong": "var(--line-strong)",
        ink: "var(--ink)",
        body: "var(--body)",
        muted: "var(--muted)",
        hairline: "var(--line)",
        coral: "var(--coral)",
        "coral-active": "var(--coral-dark)",
        dark: "#181715",
        "dark-elevated": "#252320",
        "dark-soft": "#1f1e1b",
        teal: "#5db8a6",
        amber: "#e8a55a",
        success: "#5db872",
        danger: "#c64545",
      },
      fontFamily: {
        display: ["Source Serif 4", "Noto Serif SC", "Songti SC", "serif"],
        sans: ["Plus Jakarta Sans", "Microsoft YaHei UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        quiet: "var(--shadow-quiet)",
        raised: "var(--shadow-raised)",
        overlay: "var(--shadow-overlay)",
      },
    },
  },
  plugins: [],
};

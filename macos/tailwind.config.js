/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#faf9f5",
        "surface-soft": "#f5f0e8",
        "surface-card": "#efe9de",
        "cream-strong": "#e8e0d2",
        ink: "#141413",
        body: "#3d3d3a",
        muted: "#6c6a64",
        hairline: "#e6dfd8",
        coral: "#cc785c",
        "coral-active": "#a9583e",
        dark: "#181715",
        "dark-elevated": "#252320",
        "dark-soft": "#1f1e1b",
        teal: "#5db8a6",
        amber: "#e8a55a",
        success: "#5db872",
        danger: "#c64545",
      },
      fontFamily: {
        display: ["Cormorant Garamond", "Noto Serif SC", "Songti SC", "serif"],
        sans: ["Inter", "Microsoft YaHei UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        quiet: "0 1px 3px rgba(20,20,19,.08)",
      },
    },
  },
  plugins: [],
};

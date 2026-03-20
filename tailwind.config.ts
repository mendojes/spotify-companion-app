import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        night: "#070B14",
        cobalt: "#2B59FF",
        cyan: "#31E7FF",
        coral: "#FF6B6B",
        gold: "#FFD166",
        mint: "#53F8B7",
        ink: "#CCD7F6",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.08), 0 20px 80px rgba(24, 104, 255, 0.22)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
      },
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "sans-serif"],
        display: ["var(--font-sora)", "sans-serif"],
      },
      animation: {
        float: "float 12s ease-in-out infinite",
        pulseSlow: "pulseSlow 6s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-18px)" },
        },
        pulseSlow: {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "0.95" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

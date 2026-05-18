/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#f5f5f7",
          surface: "#ffffff",
          surfaceHi: "#ebebf0",
          line: "#d2d2d7",
          text: "#1d1d1f",
          textDim: "#6e6e73",
          sunsetA: "#ff7a3d",
          sunsetB: "#ff3d8a",
          aurora: "#34c759",
          ember: "#ff3b30",
          violet: "#5856d6"
        }
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

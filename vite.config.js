import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      include: "**/*.{jsx,js,ts,tsx}",
    }),
  ],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@": "/src",
      "react-map-gl": "react-map-gl/dist/esm/index.js",
    },
  },
  optimizeDeps: {
    include: ["react-map-gl"],
    esbuildOptions: {
      loader: {
        ".js": "jsx",
      },
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset URLs: the same build works at any path — GitHub Pages
  // (https://<user>.github.io/temaricad/) and inside the Tauri app.
  base: "./",
  clearScreen: false,
  // Tauri expects a fixed port and loopback only.
  server: { host: "127.0.0.1", port: 5183, strictPort: true },
  preview: { host: "127.0.0.1", port: 5184, strictPort: true },
  build: { target: "es2022" },
});

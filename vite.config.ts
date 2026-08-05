import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      // 4. ALSO ignore runtime data dirs: ingest writes debug.log / checkpoint /
      //    queue json into the project's `.llm-wiki` and `zTradingData` every few
      //    seconds, and Vite's HMR full-reload would otherwise nuke the running
      //    ingest queue (resetting its in-memory state → infinite retry loop).
      ignored: [
        "**/src-tauri/**",
        "**/zTradingData/**",
        "**/.llm-wiki/**",
        "**/wiki/**",
        "**/raw/**",
      ],
    },
  },

  test: {
    environment: "node",
  },
}))

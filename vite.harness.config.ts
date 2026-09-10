// A second Vite entry that swaps the Tauri IPC boundary for a mock, so the
// real mail components can be rendered and screenshotted in a browser. Test
// scaffolding only — the app build never uses this config.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const mock = fileURLToPath(new URL('./harness/mockTauri.ts', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: mock },
      { find: /^@tauri-apps\/api\/event$/, replacement: mock },
      { find: /^@tauri-apps\/api\/window$/, replacement: mock },
      { find: /^@tauri-apps\/api\/dpi$/, replacement: mock },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: mock },
      { find: /^@tauri-apps\/plugin-process$/, replacement: mock },
      { find: /^@tauri-apps\/plugin-updater$/, replacement: mock },
    ],
  },
  server: { port: 5199, strictPort: true },
})

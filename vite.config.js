import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 监听所有地址：localhost 无论解析到 127.0.0.1 还是 ::1 都能连上
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/runtime-config.js': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})

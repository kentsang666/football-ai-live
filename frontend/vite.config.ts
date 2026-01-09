import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
  define: {
    // 生产环境使用 Railway 后端 URL
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 
      (mode === 'production' ? 'https://football-ai-live-production.up.railway.app' : 'http://localhost:4000')
    ),
  },
}))

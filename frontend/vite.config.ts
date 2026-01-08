import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['5173-i8tko8mwvfqk17gl8iqmr-718071c2.sg1.manus.computer'],
  },
  define: {
    // 在生产环境中，如果没有设置 VITE_API_URL，使用 Railway 后端 URL
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 
      (mode === 'production' ? 'https://football-ai-live-production.up.railway.app' : 'http://localhost:4000')
    ),
  },
}))

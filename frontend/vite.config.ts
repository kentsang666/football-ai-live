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
    // 生产环境使用空字符串（相对路径），开发环境使用本地后端
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 
      (mode === 'production' ? '' : 'http://localhost:4000')
    ),
  },
}))

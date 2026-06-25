import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/run': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/screenshots': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/runs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})

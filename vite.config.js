import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Prevent esbuild from traversing up to the broken jsconfig.json on the Desktop
  optimizeDeps: {
    esbuildOptions: {
      tsconfigRaw: '{}',
    },
  },
})

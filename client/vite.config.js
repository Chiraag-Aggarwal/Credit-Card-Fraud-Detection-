import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { validateBuildEnvironment } from './config/validateEnvironment.js'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    validateBuildEnvironment(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'))
  }
  return { plugins: [react(), tailwindcss()] }
})

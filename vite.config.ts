import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Electron loads dist/index.html via file://, where absolute asset paths
  // (Vite's default, e.g. "/assets/x.js") resolve against the filesystem
  // root and fail to load — resulting in a blank window. Relative paths
  // ("./assets/x.js") resolve correctly regardless of how the file is opened.
  base: './',
  plugins: [react()],
})

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' so the built page loads from disk inside Electron.
export default defineConfig({ plugins: [react()], base: './' });

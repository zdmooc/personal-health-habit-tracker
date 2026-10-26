import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.GITHUB_PAGES === 'true' ? '/personal-health-habit-tracker/' : '/';
export default defineConfig({
  base,
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Mes habitudes',
      short_name: 'Habitudes',
      description: 'Suivi privé, hors ligne et synchronisable',
      start_url: base,
      scope: base,
      display: 'standalone',
      theme_color: '#12392e',
      background_color: '#f4f6f3',
      icons: [
        { src: base + 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
      ]
    },
    workbox: { navigateFallback: base + 'index.html' },
    devOptions: { enabled: false }
  })]
});

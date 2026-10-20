/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'openatlas-icon.svg'],
    manifest: {
      name: 'OpenAtlas — Open Source Maps', short_name: 'OpenAtlas',
      description: 'Explore the world with open map data.', theme_color: '#edf4ef',
      background_color: '#edf4ef', display: 'standalone', start_url: '/',
      icons: [{ src: '/openatlas-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    workbox: {
      navigateFallback: '/index.html',
      globPatterns: [
        '**/*.{js,mjs,css,html,svg,woff2}',
        'offline/assets/**/*.{json,png,pbf}',
        'offline/delhi/places.json',
      ],
      // Exclude large binary routing graphs, PMTiles archives, and dynamic update manifests
      globIgnores: [
        '**/*.pmtiles',
        'offline/delhi/*.pmtiles',
        '**/*.bin',
        'offline/delhi/*.bin',
        'offline/delhi/manifest.json',
      ],
    },
  })],
})

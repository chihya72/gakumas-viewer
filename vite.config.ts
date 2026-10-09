import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  // GitHub Pages 子路径部署时由 CI 设 PAGES_BASE=/gakumas-viewer/；本地 dev 不受影响
  base: process.env.PAGES_BASE || '/',
  plugins: [
    vue(),
    {
      name: 'home-voice-local-data',
      apply: 'serve',
      configureServer(server) {
        // Read-only development access to the existing sibling project. No WAV endpoint.
        const root = process.env.HOME_VOICE_PROJECT || path.resolve(process.cwd(), '..', 'Gakumas-Home-Voice-Translate')
        server.middlewares.use('/home-voice-local', (req, res, next) => {
          const relative = (req.url || '').split('?')[0].replace(/^\//, '')
          if (!['data/voices.json', 'data/subtitle_ui.json'].includes(relative) &&
              !/^audio\/acb\/sud_vo_[a-zA-Z0-9_-]+\.acb$/.test(relative)) {
            res.statusCode = 404; res.end('Not found'); return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
          const target = path.join(root, relative)
          if (!fs.existsSync(target)) { res.statusCode = 404; res.end('Not found'); return }
          res.setHeader('Content-Type', relative.endsWith('.json') ? 'application/json' : 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          if (req.method === 'HEAD') { res.end(); return }
          const stream = fs.createReadStream(target)
          stream.on('error', next)
          stream.pipe(res)
        })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        // dev 模式关掉 Service Worker，否则会激进缓存导致改动看不到（Ctrl+Shift+R 也绕不过）
        enabled: false,
      },
      manifest: {
        name: 'SC-VIEWER',
        short_name: 'SC-VIEWER',
        start_url: '.',
        description: 'A frontend for SCTranslationData',
        icons: [
          {
            src: '/icon/プロデューサー.webp',
            sizes: '180x180',
            type: 'image/webp',
          },
        ],
        // share_target: {
        //   action: '/shared',
        //   method: 'GET',
        //   params: {
        //     title: 'title',
        //     text: 'text',
        //     url: 'url',
        //   },
        // },
      },
      workbox: {
        globIgnores: ['**/vgmstream-cli.wasm', '**/vgmstream-cli.js', '**/home-voice-worker.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => {
              if (
                url.hostname === 'event.strawberrytree.top' ||
                url.hostname === 'viewer.strawberrytree.top' ||
                url.hostname === 'sc-viewer.top' ||
                url.hostname === 'www.sc-viewer.top' ||
                url.hostname === 'event.sc-viewer.top'
              ) {
                return true
              }
              return false
            },
            handler: 'NetworkFirst',
          },
          {
            urlPattern: ({ url }) => {
              if (
                url.pathname.startsWith('/convert/cache') ||
                url.pathname.startsWith('/raw') ||
                url.hostname === 'cdn.skypack.dev' ||
                url.hostname === 'esm.sh'
              ) {
                return true
              }
              return false
            },
            handler: 'StaleWhileRevalidate',
          },
          {
            urlPattern: ({ url }) => {
              if (url.pathname.startsWith('/api')) {
                return true
              }
              return false
            },
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
  },
  resolve: {
    alias: [
      {
        find: 'vue-i18n',
        replacement: 'vue-i18n/dist/vue-i18n.cjs.js',
      },
    ],
  },
})

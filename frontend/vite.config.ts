/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** The apps carry their own copy of the interface, so there is no web server to send the usual
 *  security headers. This puts the same policy in the page itself, allowing only the app's own files
 *  and the API. */
function appPolicy(api: string): Plugin {
  const origin = api.match(/^https?:\/\/[^/]+/)?.[0] ?? ''
  const socket = origin.replace(/^http/, 'ws')
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${origin} ${socket}`.trim(),
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
  return {
    name: 'app-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    plugins: [react(), ...(env.VITE_APP_SHELL === '1' ? [appPolicy(env.VITE_API_BASE_URL ?? '')] : [])],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})

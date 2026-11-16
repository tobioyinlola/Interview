// Serves frontend/dist the way the production nginx does: same security headers, with the
// Content-Security-Policy read from nginx.conf.template so there is one source of truth.
// Usage: API_ORIGIN=http://localhost:8765 API_WS_ORIGIN=ws://localhost:8765 node serve-prod.cjs 5173
const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../dist')
const template = fs.readFileSync(path.resolve(__dirname, '../nginx.conf.template'), 'utf8')
const pageBlock = template.slice(template.indexOf('location / {'))
const csp = pageBlock
  .match(/Content-Security-Policy "([^"]+)"/)[1]
  .replaceAll('${API_ORIGIN}', process.env.API_ORIGIN)
  .replaceAll('${API_WS_ORIGIN}', process.env.API_WS_ORIGIN)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.map': 'application/json' }

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) return res.writeHead(403).end()
    const isAsset = url.pathname.startsWith('/assets/')
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (isAsset) return res.writeHead(404).end()
      file = path.join(root, 'index.html') // single-page app fallback
    }
    const headers = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': isAsset ? "default-src 'none'" : csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'display-capture=(self), microphone=(self), camera=(), geolocation=(), payment=()',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    }
    res.writeHead(200, headers)
    fs.createReadStream(file).pipe(res)
  })
  .listen(Number(process.argv[2] || 5173), () => console.log('serving dist with CSP on', process.argv[2] || 5173))

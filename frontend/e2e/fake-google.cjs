// A tiny stand-in for Google's OAuth endpoints, for the browser test only. It enforces PKCE like the
// real one: a token request whose code_verifier does not hash to the original challenge is refused.
// Control: GET /control?mode=ok|deny|unverified  (what the next sign-in does).
const http = require('http')
const crypto = require('crypto')
const codes = new Map()
let mode = 'ok'
const b64 = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/control') {
      mode = url.searchParams.get('mode') || 'ok'
      return res.end('ok')
    }
    if (url.pathname === '/auth') {
      const q = url.searchParams
      const back = new URL(q.get('redirect_uri'))
      if (mode === 'deny') {
        back.searchParams.set('error', 'access_denied')
      } else {
        const code = crypto.randomBytes(8).toString('hex')
        codes.set(code, { nonce: q.get('nonce'), challenge: q.get('code_challenge'), client: q.get('client_id'), verified: mode !== 'unverified' })
        back.searchParams.set('code', code)
      }
      back.searchParams.set('state', q.get('state'))
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        const f = new URLSearchParams(body)
        const entry = codes.get(f.get('code'))
        codes.delete(f.get('code')) // codes are single-use
        const challenge = b64(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest())
        if (!entry || entry.challenge !== challenge || f.get('client_secret') !== 'e2e-secret' || f.get('client_id') !== entry.client) {
          res.writeHead(400, { 'content-type': 'application/json' })
          return res.end(JSON.stringify({ error: 'invalid_grant' }))
        }
        const claims = { iss: 'https://accounts.google.com', aud: entry.client, exp: Math.floor(Date.now() / 1000) + 300, nonce: entry.nonce, email: 'Google.User@Example.com', email_verified: entry.verified }
        const seg = (o) => b64(Buffer.from(JSON.stringify(o)))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id_token: `${seg({ alg: 'none' })}.${seg(claims)}.sig`, access_token: 'x' }))
      })
      return
    }
    res.writeHead(404).end()
  })
  .listen(9099, () => console.log('fake google on 9099'))

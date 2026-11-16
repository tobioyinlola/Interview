import { isSupported } from './browserSupport'

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const SAFARI = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36'

describe('isSupported', () => {
  it('accepts desktop Chrome with getDisplayMedia', () => {
    expect(isSupported({ userAgent: CHROME, hasDisplayMedia: true })).toBe(true)
  })
  it.each([
    ['Firefox', FIREFOX],
    ['Safari', SAFARI],
    ['Android Chrome', ANDROID_CHROME],
  ])('rejects %s', (_n, ua) => {
    expect(isSupported({ userAgent: ua, hasDisplayMedia: true })).toBe(false)
  })
  it('rejects Chrome without getDisplayMedia', () => {
    expect(isSupported({ userAgent: CHROME, hasDisplayMedia: false })).toBe(false)
  })
})

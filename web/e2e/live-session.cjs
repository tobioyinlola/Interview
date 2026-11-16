// Real-browser end-to-end test of the live session. Run it with scripts/e2e-live.sh, which starts
// the API in fake-provider mode (no OpenAI) and the web dev server first.
const { chromium } = require('playwright')
const fs = require('fs')
const { execSync } = require('child_process')
const SHOTS = process.env.E2E_SHOTS || require('os').tmpdir()
const step = (m) => console.log('•', m)
const check = (cond, msg) => { if (!cond) throw new Error('CHECK FAILED: ' + msg) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A stand-in for "share the Meet tab with audio": a real MediaStream with a live audio track.
const FAKE_SHARE = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const ctx = new AudioContext()
    await ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0.3
    osc.frequency.value = 220
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    const video = canvas.captureStream(1).getVideoTracks()[0]
    const stream = new MediaStream([...dest.stream.getAudioTracks(), video])
    window.__stopShare = () => stream.getAudioTracks().forEach((t) => { t.stop(); t.dispatchEvent(new Event('ended')) })
    return stream
  }
}

;(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 } })
  const page = await ctx.newPage()
  await page.addInitScript(FAKE_SHARE)
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  // sign in
  await page.goto('http://localhost:5173/login')
  await page.fill('#email', `live${Date.now()}@example.com`); await page.click('button[type=submit]')
  await page.getByText('Check your email').waitFor(); await sleep(300)
  const link = [...fs.readFileSync(process.env.API_LOG, 'utf8').matchAll(/http:\/\/localhost:5173\/login\/verify\?token=[\w-]+/g)].pop()[0]
  await page.goto(link); await page.getByRole('heading', { name: 'Dashboard' }).waitFor()

  // notes
  await page.goto('http://localhost:5173/notes')
  await page.fill('#role', 'Product Manager')
  await page.fill('#notes', '## Launch project\nLed the 2025 launch with a team of 6. Cut onboarding time by 30%.')
  await sleep(2500)
  step('signed in and notes saved')

  // setup: Start stays disabled until the three conditions hold
  await page.goto('http://localhost:5173/session/new')
  await page.getByRole('option', { name: /No company/ }).waitFor({ state: 'attached' })
  const startBtn = page.getByRole('button', { name: 'Start session' })
  check(await startBtn.isDisabled(), 'Start is disabled initially')
  await page.selectOption('#company', 'none')
  check(await startBtn.isDisabled(), 'Start is disabled without consent')
  await page.getByRole('checkbox').check()
  check(await startBtn.isEnabled(), 'Start is enabled once everything is ready')
  await startBtn.click()
  await page.getByRole('heading', { name: 'Capture' }).waitFor()
  step('session created, live page open: ' + page.url())

  // share the tab -> real worklet -> real websocket -> real relay
  await page.getByRole('button', { name: 'Share Meet tab' }).click()
  await page.getByText('Listening', { exact: true }).waitFor({ timeout: 8000 })
  step('status: Listening (socket authenticated with a single-use token)')
  await sleep(600)
  const lvl = Number(await page.getByRole('meter').getAttribute('aria-valuenow'))
  console.log('   level meter value:', lvl)
  check(lvl > 5, 'the level meter moves with the shared audio')

  await page.getByText(/Tell me about a time you led a project/).first().waitFor({ timeout: 15000 })
  step('caption appeared in the transcript')
  await page.getByText(/First words in/).waitFor({ timeout: 15000 })
  await page.getByText(/Led a team to ship a launch/).waitFor()
  const first = await page.getByText(/First words in/).innerText()
  console.log('   ', first)
  await page.screenshot({ path: SHOTS + '/3-live-outline.png', fullPage: true })
  step('outline streamed from notes with a source label')

  // second question replaces the first
  await page.getByText(/Why do you want to work here/).first().waitFor({ timeout: 15000 })
  step('second caption arrived')

  // typed question + blur mode
  await page.getByRole('checkbox', { name: /Answer-first/ }).check()
  await page.fill('#manual', 'What is your biggest weakness?')
  await page.press('#manual', 'Enter')
  await page.getByRole('button', { name: 'Reveal' }).waitFor({ timeout: 10000 })
  const blurred = await page.getByTestId('outline').evaluate((e) => e.className.includes('blur'))
  check(blurred, 'the outline is blurred before Reveal')
  await page.getByRole('button', { name: 'Reveal' }).click()
  await page.screenshot({ path: SHOTS + '/4-live-blur-revealed.png', fullPage: true })
  step('typed question answered; blur mode hides then reveals')

  // recovery: restart the API mid-session. Wait for the old process to exit first, so this is a
  // real outage (the old server keeps open sockets alive during its graceful shutdown).
  execSync(`kill -TERM $(cat ${process.env.API_PID})`)
  execSync(`while kill -0 $(cat ${process.env.API_PID}) 2>/dev/null; do sleep 0.1; done`, { timeout: 20000, shell: '/bin/bash' })
  const t0 = Date.now()
  execSync(process.env.API_START, { shell: '/bin/bash' })
  let sawDrop = false
  let outcome = 'timed out'
  for (let i = 0; i < 80; i++) {
    const statuses = await page.getByRole('status').allInnerTexts().catch(() => [])
    const alerts = await page.getByRole('alert').allInnerTexts().catch(() => [])
    if (alerts.some((a) => /Capture lost/.test(a))) { outcome = 'capture lost'; break }
    if (statuses.some((t) => /Reconnecting/.test(t))) sawDrop = true
    if (sawDrop && statuses.includes('Listening')) { outcome = 'reconnected'; break }
    await sleep(250)
  }
  console.log('   after API restart:', outcome, `(${((Date.now() - t0) / 1000).toFixed(1)} s after the new server started)`)
  check(sawDrop, 'the browser noticed the connection drop (Reconnecting)')
  check(outcome === 'reconnected', 'capture recovered after the API restart')
  await page.screenshot({ path: SHOTS + '/5-after-restart.png', fullPage: true })
  check((await page.getByText(/connection lost for about/).count()) > 0, 'transcript shows a gap marker')
  step('survived an API restart: reconnected with a fresh token and marked the gap')

  // stop sharing from the browser's own control
  await page.evaluate(() => window.__stopShare())
  await page.getByText('Sharing stopped.').waitFor({ timeout: 5000 })
  step('stopping the share stops capture')
  await page.getByRole('button', { name: 'Share Meet tab' }).click()
  await page.getByText('Listening', { exact: true }).waitFor({ timeout: 8000 })

  // end the session; transcript and review
  await page.getByRole('button', { name: 'End session' }).click()
  await page.getByText('Session saved.').waitFor()
  const href = await page.getByRole('link', { name: 'Download transcript' }).getAttribute('href')
  const txt = await (await page.request.get(href)).text()
  console.log('   transcript download:\n' + txt.split('\n').map((l) => '     | ' + l).join('\n'))
  await page.getByRole('link', { name: 'Review it' }).click()
  await page.getByRole('heading', { name: 'Session review' }).waitFor()
  await page.screenshot({ path: SHOTS + '/6-review.png', fullPage: true })
  step('review page lists the saved transcript and outlines')
  console.log('page errors:', pageErrors.length ? pageErrors : 'none')
  check(pageErrors.length === 0, 'no uncaught page errors')
  check(/Tell me about a time/.test(txt) && /Why do you want to work here/.test(txt), 'the downloaded transcript has both questions')
  await browser.close()
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })

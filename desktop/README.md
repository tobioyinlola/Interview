# InterviewMeet desktop (Mac and Windows)

A locked-down Electron app that carries its own copy of the web interface (interviews, Auto-Apply,
companies, settings: the same code as the website, built in "app" mode and served from `app://interviewmeet`).
It opens instantly and shows what it last loaded with no internet; only calls to the API need a connection.
It signs in with a bearer token rather than the browser cookie. The shell adds one native thing: **hearing the interviewer**. Instead of picking a
browser tab, it shares the computer's sound output, so Meet, Zoom and Teams all work.

## Run it

```bash
cd desktop
npm install
node ../scripts/build-app-ui.js app-dist   # builds ../frontend in app mode into app-dist/
npm start                                   # opens the packed interface
INTERVIEWMEET_DEV_URL=http://localhost:5173 npm start   # develop the interface live instead (npm run dev in frontend/)
```

`INTERVIEWMEET_URL` is the site the API is reached through (default in `src/config.js`; for a build put
`{"appUrl": "https://..."}` in `desktop/app-config.json`).

## How it is kept safe

* **Screen capture protection (MANDATORY)**: `win.setContentProtection(true)` is strictly enforced on the
  window at all times. On Windows, this sets `WDA_EXCLUDEFROMCAPTURE` / `WDA_MONITOR`, and on macOS it sets
  `NSWindowSharingNone`. Screen sharing (Google Meet, Zoom, Microsoft Teams, Discord), screen recorders
  (OBS, QuickTime), and proctoring/monitoring software cannot capture or inspect the app window.
* The window only shows the app's own address. Any other https link opens in the person's normal
  browser; everything else (file:, javascript:, other schemes) is refused (`src/policy.js`, tested).
* `contextIsolation`, `sandbox`, no Node in the page. The page sees only
  `window.interviewMeetDesktop = { isDesktop, platform, systemAudio }`.
* Microphone and audio capture are granted only to the app's own pages.

## Tests

```bash
npm test      # the rules in policy.js
```

A real-window check (bridge present, no Node in the page, audio capture returns an audio track, off-site
navigation blocked) was run under a virtual display with Playwright's Electron support.

## Updates

* **The app carries its own copy of the interface**, so website changes reach it through a new release. A
  change to `frontend/` or `desktop/` that lands on `Staging` builds and publishes one automatically.
* **The app** is released automatically: a change to `desktop/` (or `frontend/`) that lands on `Staging`
  builds the Windows and Mac installers and publishes release `desktop-v0.3.<run number>`.
* **Windows** apps look for a new release when they start and every 4 hours, download it quietly, and offer
  a restart (or install it when the app is next closed).
* **Mac** apps that are not yet signed cannot install updates by themselves. The app shows an
  "update available" banner with the right download for the Mac's chip. Signing and notarization (an
  Apple Developer account) turns on silent updates there too.

## Building installers

**To publish a release (the easy way):** GitHub, Actions, **desktop**, **Run workflow**. Pick the `Staging` branch, tick
**Publish a GitHub release**, enter a version like `0.1.0`, and run it. It tests, builds, checks the packaged app
launches, then creates the tag `desktop-v<version>` and the release. The landing page's download button points at
the latest release. Pushing a tag by hand still works too.

`.github/workflows/desktop.yml` builds the Mac (Apple Silicon and Intel) and Windows installers when
a tag like `desktop-v0.1.0` is pushed, and attaches them to a GitHub release. The app checks that
release for updates when it starts.

**Without signing secrets the installers are unsigned.** Mac and Windows will then warn people. To sign,
add these repository secrets: `CSC_LINK`, `CSC_KEY_PASSWORD` (certificate), and for Mac `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarization).

## Known limits

* **Google sign-in opens your normal browser.** Google refuses to run inside an app's own window, so the
  button opens the browser, and after sign-in the browser hands the app a one-time code through the
  `interviewmeet://` address, which this app registers with Windows or macOS. The code only works with a
  secret the app made before leaving (PKCE-style), lives two minutes and works once. No Google Cloud
  change is needed: it uses the same return address as the website.
* **macOS 14.2 or later is needed** for computer-audio capture, and the person must allow "System
  Audio Recording" the first time. Older macOS cannot capture it. The usage text is in
  `electron-builder.yml`; without it macOS returns a silent stream with no error.
* Linux is not a target.
* The icon in `build/icon.png` is a placeholder.
* Only the Linux packaging step and the page checks were run here. **The Mac and Windows builds, signing,
  notarization, the macOS permission prompt and real interview audio have not been tried** (no Mac or
  Windows machine here).

# InterviewMeet desktop (Mac and Windows)

A thin, locked-down Electron shell around the live site. Everything in the web app (interviews,
Auto-Apply, companies, settings, admin) is the same code, so it stays in step with the website
automatically. The shell adds one native thing: **hearing the interviewer**. Instead of picking a
browser tab, it shares the computer's sound output, so Meet, Zoom and Teams all work.

## Run it

```bash
cd desktop
npm install
npm start                                   # opens the deployed site
INTERVIEWMEET_URL=http://localhost:5173 npm start   # or any other address (https, or http on localhost)
```

The default address is in `src/config.js`. To change it for a build, put `{"appUrl": "https://..."}` in
`desktop/app-config.json`.

## How it is kept safe

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

## Building installers

`.github/workflows/desktop.yml` builds the Mac (Apple Silicon and Intel) and Windows installers when
a tag like `desktop-v0.1.0` is pushed, and attaches them to a GitHub release. The app checks that
release for updates when it starts.

**Without signing secrets the installers are unsigned.** Mac and Windows will then warn people. To sign,
add these repository secrets: `CSC_LINK`, `CSC_KEY_PASSWORD` (certificate), and for Mac `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarization).

## Known limits

* **Google sign-in does not work inside the app** (Google blocks embedded browsers). The sign-in page
  says so and offers email and password or an email link. A hand-off through the system browser is the
  planned fix.
* **macOS 14.2 or later is needed** for computer-audio capture, and the person must allow "System
  Audio Recording" the first time. Older macOS cannot capture it. The usage text is in
  `electron-builder.yml`; without it macOS returns a silent stream with no error.
* Linux is not a target.
* The icon in `build/icon.png` is a placeholder.
* Only the Linux packaging step and the page checks were run here. **The Mac and Windows builds, signing,
  notarization, the macOS permission prompt and real interview audio have not been tried** (no Mac or
  Windows machine here).

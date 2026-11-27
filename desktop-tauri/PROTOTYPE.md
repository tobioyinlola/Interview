# InterviewMeet desktop on Tauri: prototype findings

A Tauri 2 shell that sits beside the Electron app in `../desktop`. Nothing in the Electron app, its
build or its releases was changed. The point was to find out, with working code, what moving would
cost.

## What was built and works (checked on Linux)

* The shell compiles and starts, and loads the **real** web interface (the same `build:app` bundle
  the Electron app packs: `npm run ui` copies it to `app-dist/`).
* The same `window.interviewMeetDesktop` bridge the web app already uses, over Tauri commands:
  CV picker starting in Downloads (5 MB limit), native screen-capture protection for private screens
  (never during a live session), opening only the app's own Google sign-in in the real browser, and
  the `interviewmeet://auth` link handed back after sign-in (single instance, deep link).
* The rules from `desktop/src/policy.js` ported to Rust with the same cases (`cargo test`: 4 pass).
* Capabilities are narrow: the page can reach only these commands and the dialog and deep-link
  plugins.

## What does not work, and why (the findings that matter)

1. **The web app refuses to run in a WebKit web view.** Started in this shell on Linux it shows the
   app's own "This browser isn't supported" page. The interface needs Chromium, because live
   interviews capture the computer's sound with `getDisplayMedia`. Tauri uses the system web view:
   * **Windows: WebView2** (Chromium-based). The check would pass. Audio capture of the whole
     computer's sound is available there but has not been tested here.
   * **macOS: WKWebView** and **Linux: WebKitGTK**. Neither has that capture. Live-interview audio
     would have to be rebuilt natively for each system (macOS ScreenCaptureKit, Windows WASAPI
     loopback, Linux PulseAudio/PipeWire) and streamed into the page. That is the largest piece of
     work, and it is new code on the most sensitive part of the product.
2. **The Auto-Apply workspace cannot be moved as it is.** It drives the employer page through the
   Chrome DevTools Protocol (`desktop/src/auto/driver.js`).
   * WebView2 on Windows offers the same protocol.
   * macOS and Linux web views do not. The driver would need a different mechanism there, or a
     bundled Chromium (about the size of Electron itself, which removes most of the saving), or the
     workspace stays on Electron.
   * The isolated-world reading and the per-job throw-away session also need re-checking on every
     system. The workspace has only been run on Linux (Electron); a Windows run is covered by CI.
3. **Not ported yet:** the floating answer panel as an always-on-top window, auto-update
   (`tauri-plugin-updater` needs its own signing keys and update feed), Mac signing and
   notarisation, and the build and release workflow (`.github/workflows/desktop.yml` is Electron's).
   The Electron smoke tests (`desktop/test/*.js`) would be rewritten for Tauri.

## Size, measured

* Electron runtime alone: **284 MB** unpacked (`node_modules/electron/dist`).
* Tauri: the web interface is 1.4 MB; the release binary size is in the table below. On Windows it
  relies on WebView2, which current Windows 10 and 11 already include.

## Recommendation

* **Windows only, no workspace:** a Tauri build is realistic and much smaller. Live-interview audio
  and the workspace are the open questions, both testable only on a Windows machine.
* **All desktops with every feature:** not realistic without rebuilding system-audio capture natively
  and finding a different driver for the workspace. Keep Electron for those until that is done.
* A sensible path is to test the two Windows questions (audio, DevTools) on a real Windows machine
  with this prototype before deciding anything else.

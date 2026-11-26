# Interview Meet: modes and private-screen protection

Branch `feature/interview-meet-privacy`, from `Staging` (7c8d933). Nothing from `diesel` is used.

## Audit (what is there)

- Desktop: Electron (`desktop/`), sandboxed renderer with a minimal preload bridge. No capture
  protection on `Staging`. (The `diesel` branch's capture-exclusion of the live answer panel is not
  used and should not be merged: see below.)
- Phones: Capacitor 7 (`mobile/`), Android and iOS, with one local plugin (`AppInstallerPlugin`).
- Interview Meet: the live page (`LiveSessionPage`, `PhoneSessionPage`) shows the question and a
  real-time answer; the server streams answers from `POST /api/sessions/{id}/suggest`.

## Interview modes

| Mode | Real-time answers | Needs |
|---|---|---|
| Mock interview (default; all existing sessions) | yes | everyone on the call knows the assistant is on |
| Authorised live assistance | yes | the person confirms the interviewer or organisation allowed it and says who; kept with the session (`assist_authorized_by`, `assist_authorized_at`) |
| Standard interview | **no** (the server refuses with `409 assistance_off`; the app does not ask) | nothing: transcript, notes and feedback afterwards |

Every live screen shows the assistant status at the top ("Assistant on: mock interview",
"Assistant on: authorised live assistance (authorised by ...)", "Standard interview: real-time
answers are off"). Live screens are **never** protected from capture, so anyone watching a shared
screen can see the assistant is on. Capture exclusion is not used to hide interview assistance.

## Private-screen protection

Private screens: Settings (profile, password, CV), Auto-Apply setup (CV facts, answers), the Gmail
and app-password connection, and the back office. `app/privacy.ts` turns protection on while one
is open and off when it closes, never during a live session (enforced in the app and, on the
desktop, again in the main process).

| Platform | How | Covers | Does not cover |
|---|---|---|---|
| Windows | Electron `setContentProtection` (`SetWindowDisplayAffinity`) | screenshots, recording, screen sharing of the window and of the whole screen | Windows before 10 2004 shows a black box instead |
| macOS | Electron `setContentProtection` (`NSWindowSharingNone`) | older capture paths | apps using ScreenCaptureKit can still capture it: use Presentation mode |
| Android | `FLAG_SECURE` (`PrivacyPlugin.java`) | screenshots, recordings, screen sharing, recent-apps preview (shown blank) | some manufacturer tools may differ |
| iOS | `UIScreen.capturedDidChangeNotification` + blur on resign-active (`PrivacyPlugin` in `AppDelegate.swift`) | hides private content while recording or mirroring; covers the app-switcher preview | **screenshots cannot be blocked**; hidden only after iOS reports capture |
| Website | none possible | Presentation mode only | everything |

**Presentation mode** (Settings, Privacy) replaces every private screen with a short notice while you
share, on any platform. The Privacy tab itself is never hidden, so it can always be switched off.

## What was tested here, and what was not

| Check | Result |
|---|---|
| Backend: modes, authorisation required, standard refuses answers | automated, pass |
| Frontend: controller (on only on private screens, never live), adapters called, honest platform text, Presentation mode, mode picker, status badge | automated, pass |
| Desktop: protection only for the app's own pages, never in a live session | automated (policy), pass |
| Android build and `FLAG_SECURE` effect | **not verified**: needs the CI Android build and a device |
| iOS build, capture notification, app-switcher blur | **not verified**: needs the CI Xcode build and a device |
| Google Meet, Zoom, Teams, OBS, native recorders, screenshots, mirroring | **not verified**: needs real devices and apps |

### Manual tests to run (record capture exclusion / masking / redaction / none for each)

1. Windows 11: open Settings → Profile; share the entire screen and then the window in Meet, Zoom,
   Teams; record with OBS (Display Capture and Window Capture) and with Snipping Tool; take a
   screenshot. Repeat on a live session page: it must stay visible.
2. macOS 14/15: the same with the built-in recorder (Shift-Cmd-5), QuickTime, Meet, Zoom, Teams,
   OBS (macOS 13+ uses ScreenCaptureKit: expect it to be visible; then check Presentation mode).
3. Android 12-15 on two makers: screenshot, built-in recorder, Meet screen share, recent apps on a
   private screen and on a live session.
4. iOS 17/18: screen recording from Control Centre and AirPlay mirroring on a private screen (content
   hidden), app switcher (blurred), screenshot (not blocked: expected).

## Cost

All on the device: no service, worker, paid API or model call added. No continuous monitoring: the
desktop and Android flags are set once per screen, iOS listens to one system notification.

## Migration

`0033` adds `sessions.mode` (default `mock`), `assist_authorized_by`, `assist_authorized_at`;
additive, existing sessions become `mock`. Down-revision is `0030` (Staging's head). When this and
the worker branch (`0031`, `0032`) are both merged, point the later one's `down_revision` at the
other's head so `alembic heads` shows one revision.

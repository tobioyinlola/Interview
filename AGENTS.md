# AGENTS.md — Engineering & Agent Mandates

## PERMANENT MANDATE: STEALTH MODE & SCREEN CAPTURE PROTECTION

> [!IMPORTANT]
> **Strict Architectural Enforcement for All Client Platforms**:
> When it comes to stealth mode or the interview assistance / live session features, the following rule MUST be strictly enforced across all client applications (Electron for Windows & macOS, Tauri overlay, Android, and iOS):
>
> **"App must be hidden from screen sharing, proctoring or monitoring tools at all times."**
>
> This is a non-negotiable architectural invariant. Any future agent, developer, or automated migration must preserve and maintain these screen-protection mechanisms at all times.

---

### Platform-Specific Enforcement Mechanisms

1. **Desktop App (Electron — Windows & macOS)**
   - **Path**: `desktop/src/main.js`
   - **Mechanism**: `win.setContentProtection(true)` must be called on every `BrowserWindow` instance handling interview sessions, live assistance, or the application interface.
   - **OS Behavior**:
     - **Windows**: Chromium invokes `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` / `WDA_MONITOR`. The window is rendered on the local physical display only, but completely omitted (rendered as transparent/black or completely invisible) from video streams captured via Windows Graphics Capture, Desktop Duplication, BitBlt, Zoom, Microsoft Teams, Google Meet, Discord, OBS Studio, and proctoring software.
     - **macOS**: Chromium sets `[NSWindow setSharingType:NSWindowSharingNone]`. The window is omitted from ScreenCaptureKit, CGWindowListCreateImage, QuickTime, Zoom/Meet screen shares, and monitoring daemons.

2. **Stealth Desktop Client (Tauri — Windows)**
   - **Path**: `Desktop app/src-tauri/src/main.rs`
   - **Mechanism**: Win32 API `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` is applied during setup on the window handle (`HWND`), along with optional click-through styles (`WS_EX_TRANSPARENT | WS_EX_LAYERED`).

3. **Mobile App (Android — Capacitor / Native)**
   - **Path**: `mobile/android/app/src/main/java/com/interviewmeet/app/MainActivity.java`
   - **Mechanism**: `getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);` is invoked in `onCreate`.
   - **OS Behavior**: Android WindowManager treats the surface as secure. Prevents screenshot capture, screen recording (`MediaProjection`), wireless casting (Chromecast/Miracast), remote desktop sharing, and app-switcher task snapshot previews.

4. **Mobile App (iOS — Capacitor / Native)**
   - **Path**: `mobile/ios/App/App/AppDelegate.swift`
   - **Mechanism**:
     - Privacy shield / blur view overlay active during `applicationWillResignActive` to prevent iOS App Switcher snapshots.
     - Observer on `UIScreen.capturedDidChangeNotification` / `UIScreen.main.isCaptured` to automatically obscure or shield sensitive interview views whenever iOS screen recording, AirPlay mirroring, or cable projection is initiated.

---

### Invariant Checks & Verification
- Unit & policy test suites in `desktop/test/` and `mobile/test/` must assert that screen-protection rules and configurations are present in source files.
- Never remove, disable, bypass, or make screen capture protection optional unless explicitly directed for isolated internal mock unit tests that run headless without a display server.

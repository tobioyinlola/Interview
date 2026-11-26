# InterviewMeet Desktop (Tauri 2)

Stealth desktop HUD for interview assistance. Built with Tauri 2 — replaces the Electron app with native Rust performance, ~90% smaller binary, and reliable screen capture exclusion.

## Why Tauri over Electron?

The core problem: Electron's `transparent: true`, `setOpacity()`, and `setIgnoreMouseEvents()` all add `WS_EX_LAYERED` to the window, which causes Windows to silently reject `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. This meant the stealth HUD was visible in screen captures despite our best efforts.

Tauri uses WebView2 compositing which does **not** use `WS_EX_LAYERED`, so capture exclusion works trivially — no hacks, no re-enforcement timers, no FFI workarounds.

## Architecture

```
desktop-tauri/
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── lib.rs             # App setup, stealth commands, IPC handlers
│   │   ├── main.rs            # Entry point
│   │   ├── stealth.rs         # SetWindowDisplayAffinity / content protection
│   │   ├── window.rs          # Window control + open-in-browser commands
│   │   ├── policy.rs          # Port of desktop/src/policy.js (navigation, auth link, sign-in URL rules)
│   │   └── audio/
│   │       ├── mod.rs          # Audio capture commands
│   │       └── platform/
│   │           ├── windows.rs  # WASAPI loopback capture
│   │           └── macos.rs    # ScreenCaptureKit (placeholder)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   └── tauri-bridge.ts        # Frontend bridge (replaces Electron preload.js)
└── package.json
```

## Features

| Feature | Implementation |
|---------|---------------|
| **Capture exclusion** | Native Rust `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — no WS_EX_LAYERED conflicts |
| **System audio** | WASAPI loopback on Windows (silent, no picker) |
| **Stealth HUD** | Frameless, always-on-top, click-through, hidden from Alt-Tab |
| **Global shortcuts** | Ctrl+Shift+H (toggle HUD), Ctrl+Shift+M (toggle click-through) |
| **Auto-update** | `tauri-plugin-updater` via GitHub Releases |
| **OAuth** | `interviewmeet://` deep link protocol |
| **Window controls** | Minimize, maximize, close via Tauri commands |

## Development

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
npm install

# Run in development mode (requires frontend to be built or running)
npm run dev

# Build for production
npm run build
```

## Frontend Integration

The `tauri-bridge.ts` module provides the same `window.interviewDesktop` API as the Electron preload.js:

```typescript
// Import early in your app entry point
import './tauri-bridge';

// Then use the same API as before:
window.interviewDesktop.stealth.enter();
window.interviewDesktop.stealth.exit();
window.interviewDesktop.stealth.setClickThrough(true);
window.interviewDesktop.windowControls.minimize();
```

## Build Output

- **Windows**: `.msi` installer (~5-10 MB vs Electron's ~92 MB)
- **macOS**: `.dmg` bundle


## How it maps to the Electron app

| Electron (`desktop/`) | Tauri (`desktop-tauri/`) |
| --- | --- |
| `scripts/build-app-ui.js` builds the interface in **app mode** into `app-dist/` | same script, into `dist/` (the workflow runs it) |
| `app://interviewmeet` protocol serves the packed interface | Tauri serves `dist/` at `https://tauri.localhost` (Windows) / `tauri://localhost` (Mac) |
| `preload.js` exposes `interviewDesktop` | `src-tauri/bridge.js`, injected before any page script |
| `policy.js` | `src-tauri/src/policy.rs` (same rules, unit-tested) |
| `desktopCapturer` loopback audio, no picker | native WASAPI loopback, surfaced as a `getDisplayMedia` stream by the bridge (Windows) |
| `interviewmeet://auth?code=` deep link, single instance | `tauri-plugin-deep-link` + `tauri-plugin-single-instance` |

The backend must allow the Tauri origins (`app_origins` in `backend/app/config.py`).

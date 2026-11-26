"use strict";
const { app } = require("electron");

let win32 = null;
let kernel32 = null;

if (process.platform === "win32") {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const k32 = koffi.load("kernel32.dll");

    win32 = {
      SetWindowDisplayAffinity: user32.func(
        "bool __stdcall SetWindowDisplayAffinity(uintptr_t hWnd, uint32_t dwAffinity)"
      ),
      GetWindowDisplayAffinity: user32.func(
        "bool __stdcall GetWindowDisplayAffinity(uintptr_t hWnd, _Out_ uint32_t *pdwAffinity)"
      ),
      GetWindowLongPtrW: user32.func(
        "intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int nIndex)"
      ),
      SetWindowLongPtrW: user32.func(
        "intptr_t __stdcall SetWindowLongPtrW(uintptr_t hWnd, int nIndex, intptr_t dwNewLong)"
      ),
      SetWindowPos: user32.func(
        "bool __stdcall SetWindowPos(uintptr_t hWnd, uintptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)"
      ),
    };

    kernel32 = {
      GetLastError: k32.func("uint32_t __stdcall GetLastError()"),
    };
  } catch (err) {
    console.error("[Stealth] Failed to load native bindings:", err.message);
  }
}

const WDA_NONE = 0x00000000;
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080n;
const WS_EX_APPWINDOW = 0x00040000n;
const WS_EX_LAYERED = 0x00080000n;
// SWP: NOSIZE | NOMOVE | NOZORDER | FRAMECHANGED
const SWP_FRAMECHANGED_FLAGS = 0x0001 | 0x0002 | 0x0004 | 0x0020;

function getHwnd(win) {
  const buf = win.getNativeWindowHandle();
  return process.arch === "x64" || process.arch === "arm64"
    ? buf.readBigUInt64LE(0)
    : BigInt(buf.readUInt32LE(0));
}

/**
 * Apply or remove native stealth protection.
 *
 * Windows:
 *   1. Strips WS_EX_LAYERED — CRITICAL because DWM silently rejects
 *      SetWindowDisplayAffinity on layered windows (error code 8).
 *   2. Applies WDA_EXCLUDEFROMCAPTURE (0x11) to exclude from all capture APIs.
 *   3. Toggles WS_EX_TOOLWINDOW to hide from Alt+Tab.
 *   4. Verifies via GetWindowDisplayAffinity + GetLastError.
 *
 *   IMPORTANT: We NEVER call win.setOpacity() here. Electron's setOpacity()
 *   internally uses SetLayeredWindowAttributes which UNCONDITIONALLY adds
 *   WS_EX_LAYERED back to the window — completely undoing the capture
 *   exclusion fix. Any semi-transparency for the HUD must be done via CSS
 *   (background-color: rgba() or opacity property) in the renderer.
 *
 * macOS: hides Dock icon and sets content protection.
 */
function applyNativeStealth(win, enable) {
  if (!win || win.isDestroyed()) return;

  if (process.platform === "win32" && win32) {
    const hwnd = getHwnd(win);

    // 1. Read current extended styles
    const currentStyle = BigInt(win32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));

    // 2. Build new style: toggle Alt+Tab hiding AND ALWAYS strip WS_EX_LAYERED.
    //
    //    WS_EX_LAYERED is the root cause of capture exclusion failing.
    //    It can sneak in from:
    //      - BrowserWindow created with transparent:true
    //      - Any call to win.setOpacity() (even with 1.0)
    //      - Some versions of win.setIgnoreMouseEvents()
    //    We strip it unconditionally every time stealth is applied.
    let nextStyle = enable
      ? (currentStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW & ~WS_EX_LAYERED
      : (currentStyle & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;

    win32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, nextStyle);
    win32.SetWindowPos(hwnd, 0n, 0, 0, 0, 0, SWP_FRAMECHANGED_FLAGS);
    win.setSkipTaskbar(enable);

    // 3. Apply capture exclusion AFTER stripping WS_EX_LAYERED
    const targetAffinity = enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
    const ok = win32.SetWindowDisplayAffinity(hwnd, targetAffinity);
    const err = ok ? 0 : kernel32.GetLastError();

    // 4. Read back to verify Windows actually accepted it
    const outAffinity = [0];
    win32.GetWindowDisplayAffinity(hwnd, outAffinity);

    console.log(
      `[Stealth] enable=${enable} hwnd=0x${hwnd.toString(16)} ok=${ok} err=${err} ` +
      `activeAffinity=0x${outAffinity[0].toString(16)} ` +
      `layered=${Boolean(nextStyle & WS_EX_LAYERED)}`
    );

    if (!ok && enable) {
      console.error(
        `[Stealth] FAILED to set WDA_EXCLUDEFROMCAPTURE! ` +
        `err=${err} (8 = WS_EX_LAYERED still present — check for setOpacity/transparent:true calls)`
      );
    }

    // DO NOT call win.setOpacity() — it adds WS_EX_LAYERED and breaks capture exclusion.
    // Semi-transparency is handled via CSS in the renderer (StealthTerminalHud.tsx).
    return;
  }

  if (process.platform === "darwin") {
    if (enable) {
      app.dock.hide();
    } else {
      app.dock.show();
    }
    // Re-assert AFTER dock toggle because macOS WindowServer resets
    // sharingType on activation policy change.
    win.setContentProtection(enable);
  }
}

/**
 * Re-enforce capture exclusion after an Electron API call that may have
 * sneaked WS_EX_LAYERED back onto the window (e.g. setIgnoreMouseEvents).
 * Call this after any such API when stealth is active.
 */
function reEnforceStealth(win) {
  if (!win || win.isDestroyed()) return;
  if (process.platform !== "win32" || !win32) return;

  const hwnd = getHwnd(win);
  const currentStyle = BigInt(win32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));

  // Check if WS_EX_LAYERED snuck back in
  if (currentStyle & WS_EX_LAYERED) {
    console.log("[Stealth] WS_EX_LAYERED detected after API call — stripping and re-applying affinity");
    const cleanStyle = currentStyle & ~WS_EX_LAYERED;
    win32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, cleanStyle);
    win32.SetWindowPos(hwnd, 0n, 0, 0, 0, 0, SWP_FRAMECHANGED_FLAGS);

    // Re-apply capture exclusion
    const ok = win32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    const err = ok ? 0 : kernel32.GetLastError();
    console.log(`[Stealth] re-enforce: ok=${ok} err=${err}`);
  }
}

module.exports = { applyNativeStealth, reEnforceStealth };

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
 * Windows: strips WS_EX_LAYERED (which breaks SetWindowDisplayAffinity),
 *          applies WDA_EXCLUDEFROMCAPTURE, toggles WS_EX_TOOLWINDOW for
 *          Alt+Tab hiding, and uses DWM opacity for see-through HUD.
 *
 * macOS:   hides Dock icon and sets content protection.
 */
function applyNativeStealth(win, enable) {
  if (!win || win.isDestroyed()) return;

  if (process.platform === "win32" && win32) {
    const hwnd = getHwnd(win);

    // 1. Update extended styles: toggle Taskbar/Alt+Tab visibility
    //    and STRIP WS_EX_LAYERED — it causes DWM to reject SetWindowDisplayAffinity
    //    with silent error code 8 (ERROR_NOT_ENOUGH_MEMORY).
    const currentStyle = BigInt(win32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    let nextStyle = enable
      ? (currentStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
      : (currentStyle & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;

    // CRITICAL: Strip WS_EX_LAYERED when enabling stealth — this is why the
    // Tauri app works and Electron with transparent:true does not.
    if (enable) {
      nextStyle &= ~WS_EX_LAYERED;
    }

    win32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, nextStyle);
    win32.SetWindowPos(hwnd, 0n, 0, 0, 0, 0, SWP_FRAMECHANGED_FLAGS);
    win.setSkipTaskbar(enable);

    // 2. Apply capture exclusion
    const targetAffinity = enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
    const ok = win32.SetWindowDisplayAffinity(hwnd, targetAffinity);
    const err = ok ? 0 : kernel32.GetLastError();

    // 3. Read back to verify Windows actually accepted it
    const outAffinity = [0];
    win32.GetWindowDisplayAffinity(hwnd, outAffinity);

    console.log(
      `[Stealth] enable=${enable} hwnd=0x${hwnd.toString(16)} ok=${ok} err=${err} activeAffinity=0x${outAffinity[0].toString(16)}`
    );

    // 4. Use DWM opacity for see-through HUD (safe with WDA_EXCLUDEFROMCAPTURE)
    win.setOpacity(enable ? 0.92 : 1.0);
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

module.exports = { applyNativeStealth };

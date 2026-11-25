"use strict";
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  session,
  shell,
} = require("electron");
const { load } = require("./config");
const protocolRules = require("./protocol");
const {
  SCHEME,
  navigationDecision,
  permissionAllowed,
  captureAllowed,
  parseAuthLink,
  isGoogleStartUrl,
  linkFromArgv,
} = require("./policy");

const { siteOrigin, appUrl, appOrigin, packed } = load();

// On Windows, transparent Electron windows combined with SetWindowDisplayAffinity and
// desktopCapturer can crash the GPU process, which kills the renderer (white screen).
// Disabling GPU compositing for transparent windows avoids the crash while keeping the
// window visually transparent.  This is harmless on macOS (Core Animation handles it).
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

// Log GPU process crashes so we can diagnose white-screen issues.
app.on("child-process-gone", (_event, details) => {
  if (details.type === "GPU") {
    console.error("[main] GPU process gone:", details.reason, details.exitCode);
  }
});

// the interface is served from inside the app, so it opens with no internet
if (packed) protocolRules.registerScheme(protocol);
let win = null;

// --- Native Win32 Screen Capture Protection & Click-Through ---
// Mirrors the Tauri stealth client: SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
// is called ONCE after the window is fully created and stable. Re-calling it after toggling
// WS_EX_LAYERED can cause the compositor to fall back to WDA_MONITOR behaviour (black
// rectangle in captures instead of full exclusion).
let win32Native = null;
let win32AffinityApplied = false;
if (process.platform === "win32") {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    const SetWindowDisplayAffinity = user32.func("bool __stdcall SetWindowDisplayAffinity(intptr_t hwnd, uint32_t dwAffinity)");
    const GetWindowLongW = user32.func("int32_t __stdcall GetWindowLongW(intptr_t hwnd, int32_t nIndex)");
    const SetWindowLongW = user32.func("int32_t __stdcall SetWindowLongW(intptr_t hwnd, int32_t nIndex, int32_t dwNewLong)");

    const GWL_EXSTYLE = -20;
    const WS_EX_LAYERED = 0x00080000;
    const WS_EX_TRANSPARENT = 0x00000020;
    // WDA_EXCLUDEFROMCAPTURE (0x00000011 / 17) completely excludes the window from Windows
    // Graphics Capture, Desktop Duplication, BitBlt, Zoom, Teams, Meet, Discord, OBS, and
    // proctoring software.  Unlike WDA_MONITOR (0x01) it does NOT render a black rectangle;
    // the window is simply invisible to capture APIs.
    const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

    /** Read the native HWND from an Electron BrowserWindow.  Returns null when the window
     *  is gone or the handle cannot be read. */
    function readHwnd(targetWin) {
      if (!targetWin || targetWin.isDestroyed()) return null;
      try {
        const buf = targetWin.getNativeWindowHandle();
        return process.arch === "x64" ? buf.readBigInt64LE() : buf.readInt32LE();
      } catch {
        return null;
      }
    }

    win32Native = {
      /** Apply WDA_EXCLUDEFROMCAPTURE exactly once.  Subsequent calls are no-ops so that
       *  toggling WS_EX_LAYERED (click-through) cannot accidentally reset the affinity. */
      setExcludeFromCapture: (targetWin) => {
        if (win32AffinityApplied) return true;
        const hwnd = readHwnd(targetWin);
        if (hwnd === null) return false;
        const ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        if (ok) win32AffinityApplied = true;
        return ok;
      },
      /** Toggle pointer-event passthrough.  IMPORTANT: when disabling click-through we
       *  strip only WS_EX_TRANSPARENT and keep WS_EX_LAYERED, because removing
       *  WS_EX_LAYERED can cause SetWindowDisplayAffinity to fall back to WDA_MONITOR
       *  behaviour (the black-rectangle bug). The Tauri client follows the same pattern. */
      setClickThrough: (targetWin, enable) => {
        const hwnd = readHwnd(targetWin);
        if (hwnd === null) return false;
        const ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        const new_style = enable
          ? (ex_style | WS_EX_TRANSPARENT | WS_EX_LAYERED)
          : (ex_style & ~WS_EX_TRANSPARENT); // keep WS_EX_LAYERED
        SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
        return true;
      },
    };
  } catch (err) {
    // Falls back gracefully if native binding cannot be loaded
  }
}

/** Apply Win32 screen-capture exclusion.  This is intentionally a no-op after the first
 *  successful call — see the note above about WDA_EXCLUDEFROMCAPTURE + WS_EX_LAYERED. */
function applyWin32ScreenProtection(targetWin) {
  if (win32Native && targetWin) {
    win32Native.setExcludeFromCapture(targetWin);
  }
}

// --- Stealth Mode State ---
let isStealthActive = false;
let isClickThrough = false;
let stealthTransitioning = false; // guards against re-entrant enter/exit calls
// Save normal-window geometry so we can restore it cleanly after a session
let normalBounds = null;

// interviewmeet:// is how the browser hands the app back after Google sign-in. In development the
// app is run as `electron .`, which needs its path passed along to be registered.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

let pendingLink = linkFromArgv(process.argv); // the app was started by the link (Windows, Linux)

/** The browser finished Google sign-in: carry on inside the app's window. */
function handleDeepLink(url) {
  const query = parseAuthLink(url);
  if (!query) return;
  if (!win) {
    pendingLink = url; // the window is not up yet; use the link once it is
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.loadURL(`${appOrigin}/auth/app?${query}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = linkFromArgv(argv);
    if (link) handleDeepLink(link);
    else if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault(); // macOS delivers the link here
    handleDeepLink(url);
  });
}

ipcMain.on("im:open-in-browser", (event, url) => {
  // only the app's own pages may ask, and only for its own Google sign-in address
  const from = event.senderFrame ? event.senderFrame.url : "";
  if (captureAllowed(from, appOrigin) && isGoogleStartUrl(url, siteOrigin)) {
    shell.openExternal(url);
  }
});

function openExternal(url) {
  if (navigationDecision(url, appOrigin) !== "deny") shell.openExternal(url);
}

function secure(ses) {
  ses.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(permissionAllowed(permission, details.requestingUrl || wc.getURL(), appOrigin)),
  );
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    permissionAllowed(permission, requestingOrigin, appOrigin),
  );
  // The web app asks to "share a tab". Here there is no tab picker: the whole computer's sound
  // output is shared (the interviewer's voice, from Meet, Zoom or Teams). Video is required by the
  // API but the app never reads it.
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const frameUrl = request.frame ? request.frame.url : "";
      if (!captureAllowed(frameUrl, appOrigin)) return callback({});
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        if (!sources.length) return callback({});
        callback({ video: sources[0], audio: "loopback" });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 500,
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    show: false,
    title: "InterviewMeet",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });

  // STRICT REQUIREMENT: App must be hidden from screen sharing, proctoring or monitoring tools at all times.
  //
  // macOS: setContentProtection(true) calls [NSWindow setSharingType:NSWindowSharingNone].
  //        This must be re-asserted after Dock hide/show (handled in enter/exitStealthMode).
  //
  // Windows: SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) is applied ONCE here.
  //          Like the Tauri client, we set it once and never re-apply, because re-applying
  //          after WS_EX_LAYERED toggles can cause the compositor to fall back to WDA_MONITOR
  //          (renders as a black rectangle instead of being excluded from capture).
  if (process.platform === "darwin") {
    win.setContentProtection(true);
  }

  win.once("ready-to-show", () => {
    // Apply Win32 capture exclusion once the HWND is stable and the window is fully
    // composited.  This mirrors the Tauri client's setup() — single call, never repeated.
    applyWin32ScreenProtection(win);
    win.show();
  });
  // macOS only: re-assert content protection on show/restore because WindowServer can
  // silently reset NSWindowSharingType.  On Windows the affinity set above persists.
  if (process.platform === "darwin") {
    win.on("show", () => win.setContentProtection(true));
    win.on("restore", () => win.setContentProtection(true));
  }
  // The title bar always says the app's name, not whatever the current web page is called.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setUserAgent(
    `${win.webContents.getUserAgent()} InterviewMeetDesktop/${app.getVersion()}`,
  );
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (navigationDecision(url, appOrigin) === "allow") return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const d = navigationDecision(url, appOrigin);
    if (d === "allow") return;
    event.preventDefault();
    if (d === "external") openExternal(url);
  });
  // --- Renderer crash / failure recovery ---
  // Without these handlers a renderer crash leaves a permanent white screen with no way
  // to recover.  Auto-reload lets the user continue without restarting the whole app.
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] renderer gone:", details.reason, details.exitCode);
    if (win && !win.isDestroyed()) {
      // "clean-exit" means the page navigated normally — no reload needed.
      if (details.reason !== "clean-exit") {
        setTimeout(() => {
          if (win && !win.isDestroyed()) win.loadURL(appUrl);
        }, 500);
      }
    }
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return; // sub-frame failures are harmless
    console.error("[main] did-fail-load:", code, desc, url);
    // ERR_ABORTED (-3) fires on normal navigations — ignore it.
    if (code === -3) return;
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.loadURL(appUrl);
    }, 1000);
  });
  win.webContents.on("unresponsive", () => {
    console.error("[main] renderer unresponsive");
  });
  win.webContents.on("responsive", () => {
    console.log("[main] renderer responsive again");
  });

  win.on("closed", () => {
    win = null;
    win32AffinityApplied = false; // allow re-application on a new window
  });
  win.loadURL(appUrl);
  win.webContents.once("did-finish-load", () => {
    if (pendingLink) {
      const link = pendingLink;
      pendingLink = null;
      handleDeepLink(link);
    }
  });
}

// ---------------------------------------------------------------------------
// Stealth Mode (Single-Window Dynamic Morphing)
//
// When the user enters a live interview session the window hides for ~40 ms,
// morphs into a compact floating HUD that is completely excluded from every
// screen-sharing and proctoring tool, then re-appears without focus-stealing.
// Exiting stealth restores the full-size normal window to its previous bounds.
//
// STRICT REQUIREMENT: screen-capture protection is re-asserted on EVERY entry
// into stealth mode because macOS WindowServer can silently reset NSWindowSharing
// when the Dock icon is hidden.  Content protection is also kept on during
// normal mode (setContentProtection(true) in createWindow) so the app is never
// accidentally exposed.
// ---------------------------------------------------------------------------

function enterStealthMode() {
  if (!win || win.isDestroyed()) return;
  if (isStealthActive || stealthTransitioning) return;
  stealthTransitioning = true;
  isStealthActive = true;
  isClickThrough = false;

  // Save bounds so we can restore them when exiting stealth.
  // If window is currently maximized, unmaximize first so Win32 allows sizing down.
  const wasMaximized = win.isMaximized();
  if (wasMaximized) {
    normalBounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    win.unmaximize();
  } else {
    normalBounds = win.getBounds();
  }

  // 1. Hide briefly to prevent OS resize / frame-removal flicker.
  win.hide();

  // 2. Suppress taskbar / Dock presence so the HUD is invisible to task switchers.
  if (process.platform === "darwin") {
    app.dock.hide();
  } else {
    win.setSkipTaskbar(true);
  }

  // 3. Re-assert content protection AFTER the Dock hide.
  //    macOS WindowServer can silently reset sharingType when the Dock policy changes.
  if (process.platform === "darwin") {
    win.setContentProtection(true);
  }
  // On Windows the affinity is set once in createWindow and stays — no re-assert needed.

  // 4. Morph window into compact floating HUD (450x680, matching terminal overlay ergonomics).
  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: sw } = primaryDisplay.workAreaSize;
  const targetX = Math.max(20, sw - 470);
  const targetY = 30;

  win.setMinimumSize(300, 300);
  win.setBounds({ x: targetX, y: targetY, width: 450, height: 680 });
  win.setResizable(false);
  win.setHasShadow(false);
  win.setAlwaysOnTop(true, "screen-saver", 1);
  // Float above full-screen spaces on macOS (Zoom, Meet, Teams maximised)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 5. Show without stealing focus from the interviewer's meeting window.
  win.showInactive();

  // Notify renderer that stealth state changed.
  win.webContents.send("im:stealth-state", { active: true, clickThrough: false });
  stealthTransitioning = false;
}

function exitStealthMode() {
  if (!win || win.isDestroyed()) return;
  if (!isStealthActive || stealthTransitioning) return;
  stealthTransitioning = true;
  isStealthActive = false;

  // Disable click-through before restoring.
  if (isClickThrough) {
    isClickThrough = false;
    win.setIgnoreMouseEvents(false);
    if (win32Native) win32Native.setClickThrough(win, false);
  }

  // 1. Hide while we restore the window so the morphing is invisible.
  win.hide();

  // 2. Restore normal OS chrome.
  win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(false);
  win.setResizable(true);
  win.setMinimumSize(420, 500);
  win.setHasShadow(true);

  // 3. Restore taskbar / Dock.
  if (process.platform === "darwin") {
    app.dock.show();
  } else {
    win.setSkipTaskbar(false);
  }

  // 4. Restore previous bounds, or fall back to defaults.
  if (normalBounds) {
    win.setBounds(normalBounds);
    normalBounds = null;
  } else {
    win.setSize(1280, 860);
    win.center();
  }

  // 5. Screen-capture protection stays on — it is always enforced.
  //    macOS needs re-assertion after Dock show; Windows affinity persists from createWindow.
  if (process.platform === "darwin") {
    win.setContentProtection(true);
  }

  // 6. Bring the app to the front normally.
  win.show();
  win.focus();

  // Notify renderer.
  win.webContents.send("im:stealth-state", { active: false, clickThrough: false });
  stealthTransitioning = false;
}

// IPC surface exposed to the renderer (through preload.js)
ipcMain.handle("im:stealth-set-mode", (_event, enable) => {
  if (enable) {
    enterStealthMode();
  } else {
    exitStealthMode();
  }
  return { ok: true, stealth: !!enable };
});
ipcMain.handle("im:stealth-enter", () => enterStealthMode());
ipcMain.handle("im:stealth-exit", () => exitStealthMode());
ipcMain.handle("im:stealth-set-click-through", (_event, enable) => {
  if (!win || win.isDestroyed() || !isStealthActive) return;
  isClickThrough = !!enable;
  // { forward: true } passes pointer events to whatever is beneath the HUD
  // while still letting CSS :hover states fire on the drag-handle area.
  win.setIgnoreMouseEvents(isClickThrough, { forward: true });
  if (win32Native) win32Native.setClickThrough(win, isClickThrough);
  win.webContents.send("im:stealth-state", { active: true, clickThrough: isClickThrough });
});
ipcMain.handle("im:stealth-query", () => ({
  active: isStealthActive,
  clickThrough: isClickThrough,
}));

// Frameless window control handlers for desktop normal mode
ipcMain.handle("im:window-control", (_event, action) => {
  if (!win || win.isDestroyed()) return;
  if (action === "minimize") win.minimize();
  else if (action === "maximize") {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === "close") win.close();
});
ipcMain.handle("im:window-minimize", () => {
  if (win && !win.isDestroyed()) win.minimize();
});
ipcMain.handle("im:window-maximize", () => {
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});
ipcMain.handle("im:window-close", () => {
  if (win && !win.isDestroyed()) win.close();
});

function buildMenu() {
  const mac = process.platform === "darwin";
  // Windows apps do not show a menu bar: the app looks like a program, not a web page. Copy, paste
  // and the other editing keys still work in text boxes without it. Mac keeps its menu, which the
  // system expects (and which carries Quit, Hide and the edit shortcuts).
  if (!mac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "togglefullscreen" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;

/** New versions arrive by themselves: the app looks for one when it starts and every few hours,
 *  downloads it quietly, and offers a restart when it is ready (otherwise it installs when the app is
 *  next closed). Mac apps that are not yet signed cannot install updates this way: the website shows
 *  an "update available" banner with the download instead. */
function startUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", () => {}); // updates are a convenience; the app works without them
    autoUpdater.on("update-downloaded", (info) => {
      if (!win) return;
      dialog
        .showMessageBox(win, {
          type: "info",
          title: "InterviewMeet",
          message: `Version ${info.version} is ready.`,
          detail: "Restart now to finish updating, or it will update the next time you close the app.",
          buttons: ["Restart now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        })
        .catch(() => {});
    });
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, UPDATE_EVERY_MS).unref();
  } catch {
    /* no updater available */
  }
}

app.whenReady().then(() => {
  if (packed) protocolRules.serve(protocol, path.join(__dirname, "..", "app-dist"));
  secure(session.defaultSession);
  buildMenu();
  createWindow();
  startUpdates();

  // Global hotkeys active throughout the app lifetime.
  // These let the user manage the HUD without touching the mouse or switching windows.
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!win || !isStealthActive) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.showInactive();
      // Re-assert capture protection when re-showing after a manual hide.
      // macOS needs this because WindowServer can reset sharingType; on Windows the
      // affinity persists from the initial setup.
      if (process.platform === "darwin") {
        win.setContentProtection(true);
      }
    }
  });

  globalShortcut.register("CommandOrControl+Shift+M", () => {
    if (!win || !isStealthActive) return;
    isClickThrough = !isClickThrough;
    win.setIgnoreMouseEvents(isClickThrough, { forward: true });
    if (win32Native) win32Native.setClickThrough(win, isClickThrough);
    win.webContents.send("im:stealth-state", { active: true, clickThrough: isClickThrough });
  });

  app.on("activate", () => {
    // Only create a new window if there truly are none. When stealth mode hid the Dock icon
    // the window still exists (it is just hidden from the task switcher), so we must check
    // our own `win` reference rather than relying solely on getAllWindows().
    if (!win && BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win && !win.isDestroyed() && !isStealthActive) {
      // If the app is not in stealth mode, re-show the existing window.
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") app.quit();
});

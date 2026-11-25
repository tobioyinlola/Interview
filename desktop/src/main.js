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

// the interface is served from inside the app, so it opens with no internet
if (packed) protocolRules.registerScheme(protocol);
let win = null;

// --- Stealth Mode State ---
let isStealthActive = false;
let isClickThrough = false;
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
  win.setContentProtection(true);

  win.once("ready-to-show", () => win.show());
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
  win.on("closed", () => {
    win = null;
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
  if (isStealthActive) return;
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
  win.setContentProtection(true);

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
}

function exitStealthMode() {
  if (!win || win.isDestroyed()) return;
  if (!isStealthActive) return;
  isStealthActive = false;

  // Disable click-through before restoring.
  if (isClickThrough) {
    isClickThrough = false;
    win.setIgnoreMouseEvents(false);
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
  win.setContentProtection(true);

  // 6. Bring the app to the front normally.
  win.show();
  win.focus();

  // Notify renderer.
  win.webContents.send("im:stealth-state", { active: false, clickThrough: false });
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
      // Always re-assert capture protection when re-showing after a manual hide.
      win.setContentProtection(true);
    }
  });

  globalShortcut.register("CommandOrControl+Shift+M", () => {
    if (!win || !isStealthActive) return;
    isClickThrough = !isClickThrough;
    win.setIgnoreMouseEvents(isClickThrough, { forward: true });
    win.webContents.send("im:stealth-state", { active: true, clickThrough: isClickThrough });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") app.quit();
});

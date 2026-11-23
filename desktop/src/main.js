"use strict";
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} = require("electron");
const { load } = require("./config");
const { offlinePage } = require("./offline");
const {
  SCHEME,
  navigationDecision,
  permissionAllowed,
  captureAllowed,
  parseAuthLink,
  isGoogleStartUrl,
  linkFromArgv,
} = require("./policy");

const { appUrl, appOrigin } = load();
let win = null;

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
  if (captureAllowed(from, appOrigin) && isGoogleStartUrl(url, appOrigin)) {
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
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f7f4ff",
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
  win.webContents.on("did-fail-load", (_e, code, _d, failedUrl, isMain) => {
    // -3 is a navigation that was cancelled on purpose; only real failures show the offline page
    if (isMain && code !== -3 && failedUrl.startsWith(appOrigin)) {
      win.loadURL(offlinePage(appUrl));
    }
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

function startUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    /* updates are a convenience; the app works without them */
  }
}

app.whenReady().then(() => {
  secure(session.defaultSession);
  buildMenu();
  createWindow();
  startUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

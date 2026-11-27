"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
} = require("electron");
const { load } = require("./config");
const protocolRules = require("./protocol");
const workspaceLib = require("./workspace");
const {
  SCHEME,
  navigationDecision,
  permissionAllowed,
  windowOpenDecision,
  FLOAT_FRAME,
  captureAllowed,
  parseAuthLink,
  isGoogleStartUrl,
  linkFromArgv,
  privacyDecision,
} = require("./policy");

const { siteOrigin, appUrl, appOrigin, packed } = load();

// the interface is served from inside the app, so it opens with no internet
if (packed) protocolRules.registerScheme(protocol);
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

// Private screens (settings, CV, Auto-Apply details, mailbox passwords, the back office) ask for the
// window's native content protection while they are open. Never during a live interview session.
let liveSession = false;
function protectWindow(event, want) {
  const w = BrowserWindow.fromWebContents(event.sender);
  const from = event.senderFrame ? event.senderFrame.url : "";
  const on = privacyDecision(want, liveSession, captureAllowed(from, appOrigin));
  if (w && !w.isDestroyed()) w.setContentProtection(on);
  return on;
}
ipcMain.handle("im:privacy", (event, want) => ({
  active: protectWindow(event, want === true),
  reason: liveSession ? "live-session" : undefined,
}));
ipcMain.handle("im:privacy-live", (event, on) => {
  liveSession = on === true;
  if (liveSession) protectWindow(event, false);
});

ipcMain.on("im:open-in-browser", (event, url) => {
  // only the app's own pages may ask, and only for its own Google sign-in address
  const from = event.senderFrame ? event.senderFrame.url : "";
  if (captureAllowed(from, appOrigin) && isGoogleStartUrl(url, siteOrigin)) {
    shell.openExternal(url);
  }
});

// The CV picker. The ordinary file input opens wherever the system last left off, which for a
// packaged Windows app is the app's own data folder; this one starts in Downloads.
const CV_MAX_BYTES = 5 * 1024 * 1024;
ipcMain.handle("im:pick-cv", async (event) => {
  const from = event.senderFrame ? event.senderFrame.url : "";
  if (!captureAllowed(from, appOrigin)) return null;
  const win = BrowserWindow.fromWebContents(event.sender) || undefined;
  const picked = await dialog.showOpenDialog(win, {
    title: "Choose your CV",
    defaultPath: app.getPath("downloads"),
    properties: ["openFile"],
    filters: [
      { name: "CV (PDF, Word or text)", extensions: ["pdf", "docx", "txt"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const file = picked.filePaths[0];
  const { size } = await fs.promises.stat(file);
  const name = path.basename(file);
  if (size > CV_MAX_BYTES) return { name, tooBig: true };
  return { name, data: new Uint8Array(await fs.promises.readFile(file)) };
});

// The Auto-Apply workspace: the app's own page hands over the sign-in token and API address (only
// the app's own pages may), and the workspace then carries applications out in a visible window.
// (Only an unpackaged build, run by the tests, may be told to reach a plain-http fixture site.)
const testHosts = !app.isPackaged && process.env.IM_TEST_HTTP_HOSTS ? process.env.IM_TEST_HTTP_HOSTS.split(",") : [];
const workspace = workspaceLib.create({
  electron: require("electron"),
  appVersion: app.getVersion(),
  guardOpts: { allowHttpHosts: testHosts },
  log: (...a) => { if (!app.isPackaged) console.error("[workspace]", ...a); },
});
ipcMain.handle("im:open-workspace", (event, opts) => {
  const from = event.senderFrame ? event.senderFrame.url : "";
  if (!captureAllowed(from, appOrigin) || !opts || typeof opts !== "object") return false;
  return workspace.open({
    token: typeof opts.token === "string" ? opts.token : "",
    base: typeof opts.base === "string" ? opts.base : "",
    name: require("node:os").hostname().slice(0, 60),
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux",
  });
});
ipcMain.handle("im:workspace-open", () => workspace.isOpen());

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
    backgroundColor: "#1c1b2e", // the colour of the opening animation, so nothing flashes before it
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
      // A live interview keeps listening while the window is behind the call or minimised; the
      // browser's habit of slowing hidden pages would make captions and answers late.
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // The title bar always says the app's name, not whatever the current web page is called.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setUserAgent(
    `${win.webContents.getUserAgent()} InterviewMeetDesktop/${app.getVersion()}`,
  );
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    const d = windowOpenDecision(url, frameName, appOrigin);
    if (d === "allow") return { action: "allow" };
    if (d === "float") {
      // The answer panel's own window: small, on top of the call, easy to move and resize. Nothing
      // here hides it from screen capture.
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 420,
          height: 560,
          minWidth: 300,
          minHeight: 220,
          alwaysOnTop: true,
          autoHideMenuBar: true,
          minimizable: true,
          title: "InterviewMeet: question and answer",
          backgroundColor: "#ffffff",
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child, details) => {
    if (details.frameName !== FLOAT_FRAME) return;
    child.setAlwaysOnTop(true, "floating"); // above a full-screen call, not just above windows
    child.setMenuBarVisibility(false);
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-navigate", (event) => event.preventDefault());
    const closeWithApp = () => {
      if (!child.isDestroyed()) child.close();
    };
    win.once("closed", closeWithApp);
    child.once("closed", () => win && win.removeListener("closed", closeWithApp));
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

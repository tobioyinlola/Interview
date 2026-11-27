"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// The one thing the web app learns about the desktop shell: that it is in it, and on what system.
// Nothing here can read files or run commands.
const desktopBridge = Object.freeze({
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  systemAudio: true,
  // Google sign-in has to happen in the person's real browser (Google refuses embedded windows).
  // The main process only opens the app's own sign-in address, nothing else.
  openInBrowser: (url) => {
    if (typeof url === "string") ipcRenderer.send("im:open-in-browser", url);
  },
  // Unified stealth mode toggler
  setStealthMode: (enable) => ipcRenderer.invoke("im:stealth-set-mode", enable),
  // Unified window control
  windowControl: (action) => ipcRenderer.invoke("im:window-control", action),
  // Frameless window controls for desktop normal mode
  windowControls: {
    minimize: () => ipcRenderer.invoke("im:window-minimize"),
    maximize: () => ipcRenderer.invoke("im:window-maximize"),
    close: () => ipcRenderer.invoke("im:window-close"),
  },
  // Stealth HUD controls — only usable from the live interview page.
  stealth: {
    /** Morph the window into the compact floating HUD, hidden from screen share. */
    enter: () => ipcRenderer.invoke("im:stealth-enter"),
    /** Restore the full desktop window after a session. */
    exit: () => ipcRenderer.invoke("im:stealth-exit"),
    /** Pass pointer events through the HUD (true) or capture them normally (false). */
    setClickThrough: (enable) => ipcRenderer.invoke("im:stealth-set-click-through", enable),
    /** Query current stealth state: { active: boolean, clickThrough: boolean } */
    query: () => ipcRenderer.invoke("im:stealth-query"),
    /** Subscribe to stealth state changes from the main process.
     *  Returns an unsubscribe function. */
    onStateChanged: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("im:stealth-state", handler);
      return () => ipcRenderer.removeListener("im:stealth-state", handler);
    },
  },
  // Opens the system file picker in Downloads; resolves to the chosen CV's name and bytes.
  pickCv: () => ipcRenderer.invoke("im:pick-cv"),
  // Capture protection for private screens. This build's window is always excluded from capture
  // (see AGENTS.md), so the main process only re-asserts it and reports that it is on.
  privacy: Object.freeze({
    set: (on) => ipcRenderer.invoke("im:privacy", on === true),
    setLive: (on) => ipcRenderer.invoke("im:privacy-live", on === true),
  }),
});

contextBridge.exposeInMainWorld("interviewDesktop", desktopBridge);
contextBridge.exposeInMainWorld("interviewMeetDesktop", desktopBridge);

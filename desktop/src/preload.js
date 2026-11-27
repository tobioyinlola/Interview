"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// The one thing the web app learns about the desktop shell: that it is in it, and on what system.
// Nothing here can read files or run commands.
contextBridge.exposeInMainWorld(
  "interviewMeetDesktop",
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    arch: process.arch,
    systemAudio: true,
    // Google sign-in has to happen in the person's real browser (Google refuses embedded windows).
    // The main process only opens the app's own sign-in address, nothing else.
    openInBrowser: (url) => {
      if (typeof url === "string") ipcRenderer.send("im:open-in-browser", url);
    },
    // Opens the system file picker in Downloads; resolves to the chosen CV's name and bytes.
    pickCv: () => ipcRenderer.invoke("im:pick-cv"),
    // Opens the Auto-Apply workspace (a visible window where applications are filled in). The page
    // hands over its sign-in token and API address; the main process keeps them in memory only.
    openWorkspace: (opts) => ipcRenderer.invoke("im:open-workspace", opts),
    // Native protection for private screens only; the main process refuses it during a live session.
    privacy: Object.freeze({
      set: (on) => ipcRenderer.invoke("im:privacy", on === true),
      setLive: (on) => ipcRenderer.invoke("im:privacy-live", on === true),
    }),
  }),
);

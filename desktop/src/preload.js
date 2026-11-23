"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// The one thing the web app learns about the desktop shell: that it is in it, and on what system.
// Nothing here can read files or run commands.
contextBridge.exposeInMainWorld(
  "interviewMeetDesktop",
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    systemAudio: true,
    // Google sign-in has to happen in the person's real browser (Google refuses embedded windows).
    // The main process only opens the app's own sign-in address, nothing else.
    openInBrowser: (url) => {
      if (typeof url === "string") ipcRenderer.send("im:open-in-browser", url);
    },
  }),
);

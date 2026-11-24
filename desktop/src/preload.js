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
  }),
);

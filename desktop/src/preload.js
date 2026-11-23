"use strict";
const { contextBridge } = require("electron");

// The one thing the web app learns about the desktop shell: that it is in it, and on what system.
// Nothing here can read files or run commands.
contextBridge.exposeInMainWorld(
  "interviewMeetDesktop",
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    systemAudio: true,
  }),
);

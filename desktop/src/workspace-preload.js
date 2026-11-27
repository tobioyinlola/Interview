"use strict";
// What the workspace panel may ask of the app: five narrow calls, nothing else.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("workspace", {
  snapshot: () => ipcRenderer.invoke("ws:snapshot"),
  control: (action) => ipcRenderer.invoke("ws:control", String(action)),
  speed: (speed) => ipcRenderer.invoke("ws:speed", String(speed)),
  answer: (what) => ipcRenderer.invoke("ws:answer", String(what)),
});

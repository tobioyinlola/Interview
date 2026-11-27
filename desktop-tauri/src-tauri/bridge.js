// InterviewMeet desktop bridge — the Tauri equivalent of desktop/src/preload.js.
//
// Injected by Rust (WebviewWindowBuilder::initialization_script) into the app window BEFORE any page
// script runs, exactly when Electron's preload would run. It exposes the same two globals the web
// app already looks for (`interviewDesktop` and `interviewMeetDesktop`), so the interface needs no
// changes: it sees "desktop app" and skips the landing page, shows the title bar, the stealth HUD,
// and starts Google sign-in in the real browser.
//
// __PLATFORM__ / __ARCH__ / __VERSION__ are filled in by Rust. Plain JS only (no imports).
(() => {
  "use strict";
  if (window.interviewDesktop) return;

  const PLATFORM = "__PLATFORM__"; // win32 | darwin | linux  (same values as Electron's process.platform)
  const ARCH = "__ARCH__"; // x64 | arm64
  const VERSION = "__VERSION__";

  const internals = () => window.__TAURI_INTERNALS__;
  const invoke = (cmd, args) => internals().invoke(cmd, args);

  /** Subscribe to a Rust event. Returns an unsubscribe function (events API is loaded lazily). */
  const listen = (event, cb) => {
    let off = null;
    let cancelled = false;
    const attach = () => {
      const ev = window.__TAURI__ && window.__TAURI__.event;
      if (!ev) return setTimeout(attach, 20);
      ev.listen(event, (e) => cb(e.payload)).then((un) => {
        if (cancelled) un();
        else off = un;
      });
    };
    attach();
    return () => {
      cancelled = true;
      if (off) off();
    };
  };

  const toState = (s) => ({
    active: !!(s && s.active),
    clickThrough: !!(s && (s.click_through ?? s.clickThrough)),
  });

  // The app's name in the user agent, as the Electron app did ("... InterviewMeetDesktop/1.2.3").
  try {
    const ua = navigator.userAgent + " InterviewMeetDesktop/" + VERSION;
    Object.defineProperty(navigator, "userAgent", { get: () => ua, configurable: true });
  } catch (_) {
    /* cosmetic */
  }

  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const windowControl = (action) =>
    action === "minimize"
      ? invoke("window_minimize")
      : action === "maximize"
        ? invoke("window_maximize")
        : action === "close"
          ? invoke("window_close")
          : Promise.resolve();

  const bridge = Object.freeze({
    isDesktop: true,
    platform: PLATFORM,
    arch: ARCH,
    systemAudio: true,
    // Google sign-in has to happen in the person's real browser (Google refuses embedded windows).
    // Rust only opens the app's own sign-in address, nothing else.
    openInBrowser: (url) => {
      if (typeof url === "string") invoke("open_in_browser", { url }).catch(() => {});
    },
    setStealthMode: (enable) =>
      invoke("stealth_set_mode", { enable: !!enable }).then(() => ({ ok: true, stealth: !!enable })),
    // The system file picker, starting in Downloads. Null when cancelled.
    pickCv: () =>
      invoke("pick_cv").then((r) =>
        r ? { name: r.name, ...(r.tooBig ? { tooBig: true } : {}), ...(r.data ? { data: b64ToBytes(r.data) } : {}) } : null,
      ),
    // Capture protection for private screens. This app's window is always excluded from capture, so
    // these only confirm it is on (see privacy_set / privacy_live in Rust).
    privacy: Object.freeze({
      set: (on) => invoke("privacy_set", { on: on === true }),
      setLive: (on) => invoke("privacy_live", { on: on === true }).then(() => undefined),
    }),
    windowControl,
    windowControls: Object.freeze({
      minimize: () => invoke("window_minimize"),
      maximize: () => invoke("window_maximize"),
      close: () => invoke("window_close"),
    }),
    stealth: Object.freeze({
      enter: () => invoke("stealth_enter").then(toState),
      exit: () => invoke("stealth_exit").then(toState),
      setClickThrough: (enable) => invoke("stealth_set_click_through", { enable: !!enable }).then(toState),
      query: () => invoke("stealth_query").then(toState),
      onStateChanged: (cb) => listen("stealth-state", (s) => cb(toState(s))),
    }),
  });

  Object.defineProperty(window, "interviewDesktop", { value: bridge, enumerable: true });
  Object.defineProperty(window, "interviewMeetDesktop", { value: bridge, enumerable: true });

  // ---------------------------------------------------------------------------------------------
  // Frameless window: WebView2 ignores CSS `-webkit-app-region`, which the interface's title bar and
  // HUD use for dragging. Reproduce it: press on a "drag" region to move the window, double-click it
  // to maximize. Anything marked "no-drag" (the buttons) is left alone.
  // ---------------------------------------------------------------------------------------------
  const region = (el) => {
    for (; el && el.nodeType === 1; el = el.parentElement) {
      const r = getComputedStyle(el).getPropertyValue("-webkit-app-region").trim();
      if (r === "no-drag") return "no-drag";
      if (r === "drag") return "drag";
    }
    return "";
  };
  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0 || e.detail > 1) return;
      if (region(e.target) === "drag") invoke("window_start_drag").catch(() => {});
    },
    true,
  );
  document.addEventListener(
    "dblclick",
    (e) => {
      if (region(e.target) === "drag") invoke("window_maximize").catch(() => {});
    },
    true,
  );

  // ---------------------------------------------------------------------------------------------
  // Links to other websites open in the person's normal browser (Electron's setWindowOpenHandler).
  // ---------------------------------------------------------------------------------------------
  const isExternal = (href) => {
    try {
      const u = new URL(href, location.href);
      return (u.protocol === "https:" || u.protocol === "mailto:") && u.origin !== location.origin;
    } catch (_) {
      return false;
    }
  };
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a && isExternal(a.href)) {
        e.preventDefault();
        invoke("open_external", { url: a.href }).catch(() => {});
      }
    },
    true,
  );
  const realOpen = window.open;
  window.open = function (url, ...rest) {
    if (typeof url === "string" && isExternal(url)) {
      invoke("open_external", { url: new URL(url, location.href).href }).catch(() => {});
      return null;
    }
    return realOpen ? realOpen.call(window, url, ...rest) : null;
  };

  // ---------------------------------------------------------------------------------------------
  // System audio (Windows). Electron answers the web app's "share a tab" request with the whole
  // computer's sound output, no picker. WebView2 would show a screen picker instead, so on Windows
  // the same request is answered from the native WASAPI loopback capture in Rust: the interviewer's
  // voice from Meet, Zoom or Teams, as an audio-only MediaStream the app already knows how to read.
  // ---------------------------------------------------------------------------------------------
  if (PLATFORM === "win32" && navigator.mediaDevices) {
    const realGetDisplayMedia = navigator.mediaDevices.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      : null;

    const b64ToFloat32 = (b64) => {
      const bin = atob(b64);
      const n = bin.length >> 1;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v & 0x8000) v -= 0x10000;
        out[i] = v / 32768;
      }
      return out;
    };

    const nativeSystemAudio = async () => {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      let playAt = 0;
      const off = listen("audio-data", (p) => {
        if (!p || !p.pcm) return;
        const samples = b64ToFloat32(p.pcm);
        if (!samples.length) return;
        const buf = ctx.createBuffer(1, samples.length, p.sampleRate || 48000);
        buf.copyToChannel(samples, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(dest); // into the stream only: nothing is played through the speakers
        const when = Math.max(ctx.currentTime + 0.05, playAt);
        src.start(when);
        playAt = when + buf.duration;
      });
      try {
        await ctx.resume();
        await invoke("start_audio_capture", { deviceId: null });
      } catch (err) {
        off();
        ctx.close().catch(() => {});
        throw err;
      }
      const stream = dest.stream;
      let stopped = false;
      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        off();
        invoke("stop_audio_capture").catch(() => {});
        ctx.close().catch(() => {});
      };
      for (const track of stream.getTracks()) {
        const realStop = track.stop.bind(track);
        track.stop = () => {
          realStop();
          cleanup();
        };
      }
      return stream;
    };

    navigator.mediaDevices.getDisplayMedia = async function (constraints) {
      // Only the app's own "capture system audio" request is answered natively.
      if (constraints && constraints.audio) {
        try {
          return await nativeSystemAudio();
        } catch (err) {
          throw new DOMException(String((err && err.message) || err), "NotReadableError");
        }
      }
      if (realGetDisplayMedia) return realGetDisplayMedia(constraints);
      throw new DOMException("Screen capture is not available", "NotSupportedError");
    };
  }
})();

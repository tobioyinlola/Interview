package com.interviewmeet.app;

import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Private screens (settings, CV, Auto-Apply details, mailbox passwords) ask Android to treat the
 * window as secure while they are open: screenshots, screen recordings, screen sharing and the
 * recent-apps preview then show a blank screen instead of the page. The app turns it off again as
 * soon as the private screen closes, and never asks for it during a live interview session.
 * FLAG_SECURE is Android's documented way to do this; nothing else is used.
 */
@CapacitorPlugin(name = "Privacy")
public class PrivacyPlugin extends Plugin {
    @PluginMethod
    public void setProtected(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            JSObject out = new JSObject();
            out.put("active", on);
            call.resolve(out);
        });
    }
}

package com.interviewmeet.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // STRICT REQUIREMENT: App must be hidden from screen sharing, proctoring or monitoring tools at all times.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        // our own plugin: lets the app download and install its own update (see AppInstallerPlugin)
        registerPlugin(AppInstallerPlugin.class);
        // private screens: keeps them out of screenshots, recordings and recent apps (see PrivacyPlugin)
        registerPlugin(PrivacyPlugin.class);
        registerPlugin(DualAudioCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

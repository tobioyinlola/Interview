package com.interviewmeet.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // our own plugin: lets the app download and install its own update (see AppInstallerPlugin)
        registerPlugin(AppInstallerPlugin.class);
        // private screens: keeps them out of screenshots, recordings and recent apps (see PrivacyPlugin)
        registerPlugin(PrivacyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

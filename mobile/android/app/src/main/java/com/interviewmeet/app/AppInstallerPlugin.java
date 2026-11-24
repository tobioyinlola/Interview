package com.interviewmeet.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Updates the app from inside the app: downloads the new APK to the app's own cache, checks it is the
 * file we meant (checksum) and that it was signed by the same key as the installed app (Android would
 * refuse it otherwise, and the person would have to delete and reinstall), then hands it to Android's
 * installer. Android always asks the person to confirm an install, and the app is replaced and closed
 * by Android when they do; they open it again and it is the new version.
 */
@CapacitorPlugin(name = "AppInstaller")
public class AppInstallerPlugin extends Plugin {
    private static final String DIR = "updates";
    private static final String FILE = "update.apk";
    private static final String PREFIX = "https://github.com/";

    private File apk() {
        File dir = new File(getContext().getCacheDir(), DIR);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, FILE);
    }

    private boolean mayInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** Whether Android already lets this app install updates (the person allows it once). */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("canInstall", mayInstall());
        call.resolve(out);
    }

    /** Opens the Android screen where the person allows this app to install updates. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("settings");
        }
    }

    /** Downloads and checks the file. Resolves with {sameSigner, build}. Sends "progress" events. */
    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url", "");
        final String expected = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        if (url == null || !url.startsWith(PREFIX) || !url.contains("/releases/download/")) {
            call.reject("url");
            return;
        }
        if (expected.length() != 64) {
            call.reject("checksum");
            return;
        }
        new Thread(() -> {
            File target = apk();
            File part = new File(target.getPath() + ".part");
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                if (conn.getResponseCode() != 200) {
                    call.reject("http");
                    return;
                }
                long total = conn.getContentLength(); // -1 when the server does not say
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                long received = 0;
                long lastTold = 0;
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        received += n;
                        if (received - lastTold > 256 * 1024) {
                            lastTold = received;
                            JSObject p = new JSObject();
                            p.put("received", received);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : sha.digest()) hex.append(String.format("%02x", b));
                if (!hex.toString().equals(expected)) {
                    //noinspection ResultOfMethodCallIgnored
                    part.delete();
                    call.reject("checksum");
                    return;
                }
                if (!part.renameTo(target)) {
                    call.reject("storage");
                    return;
                }
                JSObject done = new JSObject();
                done.put("sameSigner", sameSigner(target));
                done.put("build", archiveBuild(target));
                call.resolve(done);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                call.reject("network");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /** Opens Android's installer on the downloaded file. */
    @PluginMethod
    public void install(PluginCall call) {
        File file = apk();
        if (!file.exists()) {
            call.reject("missing");
            return;
        }
        if (!mayInstall()) {
            call.reject("permission");
            return;
        }
        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("install");
        }
    }

    @SuppressWarnings("deprecation")
    private Set<String> signers(PackageInfo info) throws Exception {
        Set<String> out = new HashSet<>();
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo si = info.signingInfo;
            if (si == null) return out;
            sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
        } else {
            sigs = info.signatures;
        }
        if (sigs == null) return out;
        for (Signature s : sigs) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest(s.toByteArray())) hex.append(String.format("%02x", b));
            out.add(hex.toString());
        }
        return out;
    }

    @SuppressWarnings("deprecation")
    private int flags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
    }

    /** True when the downloaded file is signed by the key that signed the installed app. */
    private boolean sameSigner(File file) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo mine = pm.getPackageInfo(getContext().getPackageName(), flags());
            PackageInfo theirs = pm.getPackageArchiveInfo(file.getPath(), flags());
            if (theirs == null || !getContext().getPackageName().equals(theirs.packageName)) return false;
            Set<String> a = signers(mine);
            Set<String> b = signers(theirs);
            if (a.isEmpty() || b.isEmpty()) return false;
            for (String s : b) if (a.contains(s)) return true;
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private long archiveBuild(File file) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(file.getPath(), 0);
            if (info == null) return 0;
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }
}

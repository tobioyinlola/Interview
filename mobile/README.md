# InterviewMeet mobile (iPhone and Android)

A Capacitor app that carries its own copy of the web interface (Auto-Apply, companies, session review, CV,
settings: the same code as the website, built in "app" mode). It opens instantly, shows what it last loaded
with no internet, and only the calls to the API need a connection. It signs in with a bearer token, not the
browser cookie (the backend accepts the app's addresses in `APP_ORIGINS`, and `x-client: app` asks for a token).

```bash
cd mobile && npm ci
INTERVIEWMEET_URL=https://your-site npm run build:web   # builds ../frontend in app mode into www/
npx cap sync android
```

`INTERVIEWMEET_URL` is the site the API is reached through (https, or localhost while developing); the CI
builds read it from the repository variable of the same name.

## How the app opens

Every app (Windows, Mac, Android) opens with a short logo animation (`frontend/src/features/splash/`), once per
launch, then goes to sign-in (new accounts are created from there). A tap skips it, it is shorter for people who
ask their phone for less motion, and it is skipped when the browser is handing a sign-in back to the app.

A **new Android install** first shows three illustrated welcome slides (`features/phone/Welcome.tsx`) with
"Get started" (create an account), "I already have an account" and Skip. It is remembered, so it shows once.

## How the phone app looks

The phone app is not the website squeezed down. When the page runs inside this app it gets its own layout
(`frontend/src/features/phone/`):

* **Three icons** in a floating bar: Home, Auto-Apply (raised, in the middle) and Companies. Everything else
  (settings, history, invite friends, help, privacy, terms, sign out) is under the profile, reached from the
  round avatar.
* **Home** is short: a greeting, one "next step" card, one number (applications sent) with the day ring, four
  shortcuts and the last few items.
* **Auto-Apply** is a compact card, three small numbers, and three sections shown one at a time
  (To do / Sent / Search) instead of one long page.
* Icons come from Lucide. The website and the desktop app are unchanged.

## Updates

Nobody should ever have to delete the app and install it again. Two kinds of update, both inside the app:

* **A new interface** (almost every change). The release `interface-latest` holds the same interface that is
  inside the app, as `interface.zip`, with a note (`{"version", "native_min", "commit"}`). The installed app
  asks the API (`/api/app/releases`), downloads it quietly, checks its SHA-256, and offers **Restart** (it is
  also used the next time the app is opened). The running copy confirms it started (`notifyAppReady`); if it
  does not within 20 seconds, the plugin puts the last good copy back by itself, so an update cannot leave the
  app unable to open. `native_min` is the oldest installed build that can run it: it rises only when the
  Android/iPhone project, the plugins or the Capacitor config changed (`scripts/ui-release.js`), and a phone
  older than that gets the app update below instead. Plugin: `@capgo/capacitor-updater`, in manual mode with
  every address pointing at the plugin maker's cloud turned off (`capacitor.config.ts`).
* **A new app** (native changes). The banner downloads `android-latest` inside the app
  (`AppInstallerPlugin.java`), checks its SHA-256 and that it was signed with the same key as the installed app,
  then opens Android's installer. Android always asks for one confirmation, and the person allows installs from
  InterviewMeet once. The app is replaced and closed by Android; opening it again runs the new version.
* A pop-up notification (once per version, when the app is opened) says an app update is waiting. A
  notification while the app is *closed* needs Firebase Cloud Messaging push: not set up yet.

### The signing key (this is what stops "App not installed")

Android only installs an update over an app signed with the **same key**. If the signing secrets are not set,
every CI build is signed with a different throwaway key and no phone can update in place. Set these four
repository secrets once, with a key you keep forever: `ANDROID_KEYSTORE_BASE64` (the keystore file, base64),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Each build then prints the signing
certificate ("Say which signing key was used"); its fingerprint must be identical in every run. Phones that
installed a build signed with an earlier throwaway key must reinstall once; after that, updates are in place.
Lose the key and everyone has to reinstall once more, so keep a copy somewhere safe.

## What works on a phone, and what does not

* Works: Auto-Apply (setup, approvals, dashboard), companies and briefs, past sessions and reviews, CV, settings.
* **Live interviews do not work on a phone.** They capture the call's audio, which iOS and Android do not let an
  app do. The app says so and points to the desktop app. A microphone-only mode and a "companion" view that shows
  a desktop interview's answers on the phone are planned, not built.
* **Google sign-in** opens the phone's browser (Google refuses to run inside an app's own window), and the
  browser hands the app a one-time code back through `interviewmeet://auth` (registered in the Android manifest
  and iOS `Info.plist`). It uses the `@capacitor/browser` and `@capacitor/app` plugins through the Capacitor
  bridge. Not yet tried on a real phone.

## Build

CI does the building (`.github/workflows/mobile.yml`), because it needs the Android SDK and Xcode:

* **Android:** a debug APK, downloadable from the run page. Install it on a phone by opening the file
  (allow "install unknown apps"). It is signed with a throwaway key, so it is for trying only.
* **iOS:** a simulator build that proves the project compiles. It cannot be installed on a real iPhone.

To build locally you need JDK 21 plus Android Studio for Android, or a Mac with Xcode and CocoaPods for iOS:

```bash
cd mobile
npm install
npx cap sync
npx cap open android   # or: npx cap open ios
```

## To reach the stores (needs you)

* **Apple:** an Apple Developer account (about $99 a year, from memory), then a distribution certificate and
  provisioning profile, App Store Connect listing, screenshots, privacy answers.
* **Google Play:** a Play Console account (a one-time fee, from memory), an upload key (keep it safe),
  a signed release bundle (`bundleRelease`), store listing and data-safety form.
* Both stores need an in-app **account deletion** option and a privacy policy link.
* Apple may reject an app that is mostly a web view (guideline 4.2). Native features such as push notifications,
  Face ID unlock and a share-sheet action for sending a job link into Auto-Apply are planned to address that.
* Apple's in-app purchase rules will apply when paid plans arrive.

## Not done or not tested

* The Android and iOS builds have not run yet (the sandbox has no Android SDK or Xcode); CI will be the first.
* Nothing has been run on a real phone: status bar and notch spacing, the keyboard, and the back button
  are unchecked.
* The icon is a placeholder, and there is no splash artwork.
* Push notifications, biometric unlock and the share-sheet are not built.

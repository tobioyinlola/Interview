# InterviewMeet mobile (iPhone and Android)

A Capacitor shell around the live site. Everything in the web app (Auto-Apply, companies, session review,
CV, settings) is the same code, so it stays in step with the website, and the login cookie stays
first-party. The app address is in `capacitor.config.ts`; change it for a build with `INTERVIEWMEET_URL`.

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

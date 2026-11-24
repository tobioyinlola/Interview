import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var privacyBlurView: UIVisualEffectView?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // STRICT REQUIREMENT: App must be hidden from screen sharing, proctoring or monitoring tools at all times.
        NotificationCenter.default.addObserver(self, selector: #selector(screenCaptureChanged), name: UIScreen.capturedDidChangeNotification, object: nil)
        return true
    }

    @objc private func screenCaptureChanged() {
        if UIScreen.main.isCaptured {
            showPrivacyShield()
        } else {
            hidePrivacyShield()
        }
    }

    private func showPrivacyShield() {
        guard let window = window, privacyBlurView == nil else { return }
        let blurEffect = UIBlurEffect(style: .dark)
        let blurView = UIVisualEffectView(effect: blurEffect)
        blurView.frame = window.bounds
        blurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        blurView.tag = 9999
        window.addSubview(blurView)
        privacyBlurView = blurView
    }

    private func hidePrivacyShield() {
        privacyBlurView?.removeFromSuperview()
        privacyBlurView = nil
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // STRICT REQUIREMENT: App must be hidden from screen sharing, proctoring or monitoring tools at all times.
        showPrivacyShield()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive.
        if !UIScreen.main.isCaptured {
            hidePrivacyShield()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

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

// MARK: - Private screens

/// Registers the app's own plugins with Capacitor (the storyboard uses this controller).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrivacyPlugin())
    }
}

/// iOS cannot block screenshots or keep part of a screen out of a recording, and this does not try.
/// It uses only what iOS documents: it tells the page when the screen starts or stops being recorded
/// or mirrored (UIScreen.capturedDidChangeNotification), so private screens can hide their content,
/// and while a private screen is open it covers the app-switcher preview with a blur.
@objc(PrivacyPlugin)
public class PrivacyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrivacyPlugin"
    public let jsName = "Privacy"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setProtected", returnType: CAPPluginReturnPromise)
    ]
    private var isProtected = false
    private var cover: UIView?

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(captureChanged),
                           name: UIScreen.capturedDidChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(willResignActive),
                           name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didBecomeActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc func setProtected(_ call: CAPPluginCall) {
        isProtected = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.sendCaptureState()
            call.resolve(["active": self.isProtected])
        }
    }

    @objc private func captureChanged() {
        DispatchQueue.main.async { self.sendCaptureState() }
    }

    private func sendCaptureState() {
        let screen = bridge?.viewController?.view.window?.windowScene?.screen ?? UIScreen.main
        notifyListeners("captureChanged", data: ["captured": screen.isCaptured])
    }

    @objc private func willResignActive() {
        guard isProtected, cover == nil, let window = bridge?.viewController?.view.window else { return }
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        blur.frame = window.bounds
        blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(blur)
        cover = blur
    }

    @objc private func didBecomeActive() {
        cover?.removeFromSuperview()
        cover = nil
    }
}

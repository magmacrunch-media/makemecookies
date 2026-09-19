import Capacitor
import UIKit

/// Exists for one line: `GameCenterPlugin` cannot be auto-discovered, and this
/// is where a plugin instance can still be registered. See the comment at the
/// top of `GameCenterPlugin.swift` for why the usual routes do not work.
///
/// Both `SceneDelegate` and `Base.lproj/Main.storyboard` name this class.
/// `Info.plist` sets `UISceneStoryboardFile`, so UIKit instantiates the
/// storyboard's controller *before* `SceneDelegate` replaces it — leaving the
/// storyboard on the stock `CAPBridgeViewController` builds a second bridge
/// and a second `WKWebView` on every launch, and, worse here, one of the two
/// has no plugin registered.
class GameViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}

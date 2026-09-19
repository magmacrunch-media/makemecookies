import Capacitor
import Foundation
import GameKit
import UIKit

/// The native half of `shim/gamekit-scores.js` and `shim/gamekit-achievements.js`.
///
/// Those two files define the contract and degrade to doing nothing when this
/// plugin is absent, which is how the game stays identical in a browser and
/// for a player who declines to sign in. The four methods here are exactly the
/// ones they call:
///
///     signIn()                                    -> { authenticated: Bool }
///     submitScore({ leaderboardId, score })       -> void
///     showLeaderboard({ leaderboardId })          -> void
///     reportAchievement({ achievementId, percent })-> void
///
/// ## It is registered by hand, and has to be
///
/// Capacitor 8 builds its plugin list from `packageClassList` in
/// `capacitor.config.json`, which `cap sync` regenerates from the npm plugin
/// list every time — a class name added there by hand does not survive a
/// build. And `registerPluginType(_:)` returns immediately while
/// `autoRegisterPlugins` is true, which it is. So a `CAPPlugin` subclass
/// dropped into the app target is simply never registered, and because the
/// JavaScript side degrades silently by design, the symptom is "Game Center
/// does nothing" with no error anywhere.
///
/// `GameViewController.capacitorDidLoad()` calls
/// `bridge?.registerPluginInstance(...)`, which is the door that stays open.
/// Do not replace that with a `packageClassList` entry.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievement", returnType: CAPPluginReturnPromise)
    ]

    /// `authenticateHandler` is not a completion handler: GameKit keeps it and
    /// calls it again on every later change of state — signing out, returning
    /// from Settings, a second sign-in sheet. A JavaScript promise can only be
    /// settled once, so the calls waiting on the first outcome are held here
    /// and released together.
    private var waiting: [CAPPluginCall] = []
    private var handlerInstalled = false
    /// Whether the handler has reported an outcome at least once. A `signIn`
    /// arriving afterwards must be answered from the player's current state
    /// rather than queued: the handler has already said its piece and may
    /// never fire again, and a queued call would simply hang.
    ///
    /// That is not hypothetical. The shim calls `signIn` as the page loads,
    /// GameKit answered 56ms later with "local player has not been
    /// authenticated", and every later call — a sign-in button, a retry —
    /// waited forever on a handler that had already finished. The app looked
    /// fine, because the one call it makes at startup is the one that worked.
    private var reported = false

    // MARK: - signIn

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if GKLocalPlayer.local.isAuthenticated {
                call.resolve(["authenticated": true])
                return
            }
            if self.reported {
                // Not signed in, and GameKit has already said so once.
                call.resolve(["authenticated": false])
                return
            }

            self.waiting.append(call)
            guard !self.handlerInstalled else { return }
            self.handlerInstalled = true

            GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, _ in
                guard let self = self else { return }

                if let viewController = viewController {
                    // Apple's own sign-in sheet. Presenting it is all that is
                    // asked; the handler is called again with the outcome, so
                    // nothing is settled here.
                    self.bridge?.viewController?.present(viewController, animated: true)
                    return
                }

                // An error here is not a failure worth surfacing: no network,
                // or a player who declined. Both mean "not signed in", which
                // the game already handles.
                let authenticated = GKLocalPlayer.local.isAuthenticated
                self.reported = true
                if authenticated {
                    // The floating Game Center badge overlaps a board that
                    // already fills the screen.
                    GKAccessPoint.shared.isActive = false
                }
                self.settle(authenticated: authenticated)
            }
        }
    }

    private func settle(authenticated: Bool) {
        let calls = waiting
        waiting = []
        for call in calls {
            call.resolve(["authenticated": authenticated])
        }
    }

    // MARK: - scores

    @objc func submitScore(_ call: CAPPluginCall) {
        guard let leaderboardId = call.getString("leaderboardId") else {
            call.reject("leaderboardId is required")
            return
        }
        guard let score = call.getInt("score") else {
            call.reject("score is required")
            return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("not signed in to Game Center")
            return
        }

        GKLeaderboard.submitScore(
            score,
            context: 0,
            player: GKLocalPlayer.local,
            leaderboardIDs: [leaderboardId]
        ) { error in
            if let error = error {
                call.reject("could not submit the score", nil, error)
            } else {
                call.resolve()
            }
        }
    }

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("not signed in to Game Center")
            return
        }

        DispatchQueue.main.async {
            // A null leaderboardId is the shim asking for the list, which is
            // what it sends when no mode has been played yet.
            let controller: GKGameCenterViewController
            if let leaderboardId = call.getString("leaderboardId") {
                controller = GKGameCenterViewController(
                    leaderboardID: leaderboardId,
                    playerScope: .global,
                    timeScope: .allTime
                )
            } else {
                controller = GKGameCenterViewController(state: .leaderboards)
            }

            // Without a delegate the Done button does nothing and the player
            // is stuck on Apple's screen with no way back to the game.
            controller.gameCenterDelegate = self

            guard let host = self.bridge?.viewController else {
                call.reject("no view controller to present from")
                return
            }
            host.present(controller, animated: true) {
                call.resolve()
            }
        }
    }

    // MARK: - achievements

    @objc func reportAchievement(_ call: CAPPluginCall) {
        guard let achievementId = call.getString("achievementId") else {
            call.reject("achievementId is required")
            return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("not signed in to Game Center")
            return
        }

        let achievement = GKAchievement(identifier: achievementId)
        achievement.percentComplete = call.getDouble("percent") ?? 100
        // The banner is the point: it is how the player learns the discovery
        // was worth something beyond the codex.
        achievement.showsCompletionBanner = true

        GKAchievement.report([achievement]) { error in
            if let error = error {
                call.reject("could not report the achievement", nil, error)
            } else {
                call.resolve()
            }
        }
    }
}

extension GameCenterPlugin: GKGameCenterControllerDelegate {
    public func gameCenterViewControllerDidFinish(_ controller: GKGameCenterViewController) {
        controller.dismiss(animated: true)
    }
}

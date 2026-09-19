#!/bin/bash
# Capture App Store screenshots from a simulator. Run on the Mac, after a
# build, with shots.js beside the output directory:
#
#   xcodebuild -project ios/App/App/App.xcodeproj -scheme App \
#     -sdk iphonesimulator -derivedDataPath ~/Library/Developer/mmc-derived build
#   mkdir -p ~/mmc-shots && cp ios/tools/screenshots/shots.js ~/mmc-shots/
#   bash ios/tools/screenshots/capture.sh <device-udid> iphone-6.9
#
# App Store Connect wants one 6.9" iPhone size and, because the app is
# universal, one 13" iPad size. iPhone 17 Pro Max gives 1320x2868 and iPad
# Pro 13-inch 2064x2752; landscape swaps each pair, and Apple accepts either
# orientation as long as the pixel count matches. `xcrun simctl list devices`
# has the udids.
#
# ## Landscape, and why the rotation step is here
#
# The board is 960x420. In portrait on a phone it sits in a band across the
# top third with two thirds of the screen empty, which is a poor listing and a
# worse first launch. Checked in a browser at 375x812 before this script was
# written, which is why it rotates rather than shooting what the simulator
# opens with.
#
# There is no `simctl` verb for rotation, so it goes through the Simulator
# app's own menu command. That is the one step here that can silently do
# nothing, which is why the script shoots the title card only AFTER rotating
# and why the first thing to check in the output is that it is wider than it
# is tall. If ios/App/App/App/Info.plist is ever locked to landscape, delete
# this step: the app will already open the right way round.
#
# The staging script is injected into a COPY of the built app, so nothing in
# the checkout or the real bundle is touched. It drives the real UI, so the
# screenshots are of the app as it is, arranged rather than faked.
#
# The offsets below are a timeline, not guesses to nudge one at a time.
# shots.js holds each arranged frame for nine seconds and freezes the render
# loop while it does, so a shot that lands on the wrong stage means the two
# drifted apart: read shots.js, not the sleeps.
set -e
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
D="$1"
NAME="$2"
APP=~/Library/Developer/mmc-derived/Build/Products/Debug-iphonesimulator/App.app
OUT=~/mmc-shots/"$NAME"
BUNDLE=com.magmacrunch.makemecookies
mkdir -p "$OUT"

# Inject the staging script into a copy of the built app, so the checkout and
# the real bundle stay clean.
STAGED=/tmp/mmc-staged.app
rm -rf "$STAGED"
cp -R "$APP" "$STAGED"
python3 - "$STAGED/public/index.html" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
html = p.read_text()
assert '</body>' in html
html = html.replace('</body>', '<script src="shots.js"></script>\n</body>', 1)
p.write_text(html)
PY
cp ~/mmc-shots/shots.js "$STAGED/public/shots.js"

xcrun simctl boot "$D" 2>/dev/null || true
xcrun simctl bootstatus "$D" >/dev/null 2>&1 || true
xcrun simctl uninstall "$D" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$D" "$STAGED"
xcrun simctl status_bar "$D" override --time "9:41" --batteryState charged \
  --batteryLevel 100 --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3

# Rotate to landscape before launching, so the app never lays out portrait.
osascript -e 'tell application "Simulator" to activate' \
          -e 'tell application "System Events" to key code 124 using command down' || true
sleep 1

xcrun simctl launch "$D" "$BUNDLE" >/dev/null

shoot () { sleep "$1"; xcrun simctl io "$D" screenshot --type=png "$OUT/$2.png" >/dev/null 2>&1; echo "  $2"; }
# Cumulative from launch. shots.js: click at 9s, then a frame every 9s.
shoot 7  1-title
shoot 7  2-line
shoot 9  3-fire
shoot 9  4-stars
shoot 8  5-bests

xcrun simctl terminate "$D" "$BUNDLE" 2>/dev/null || true

# The first thing to check: landscape means width greater than height. If these
# come back portrait, the rotation step did nothing and the shots are of the
# wrong layout, whatever else looks right.
sips -g pixelWidth -g pixelHeight "$OUT"/1-title.png | tail -2
ls "$OUT"

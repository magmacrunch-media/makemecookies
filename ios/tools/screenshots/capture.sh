#!/bin/bash
# Capture App Store screenshots from a simulator. Run on the Mac, after a
# build, with shots.js beside the output directory:
#
#   xcodebuild -project ios/App/App/App.xcodeproj -scheme App \
#     -sdk iphonesimulator -derivedDataPath ~/Library/Developer/mmc-derived build
#   mkdir -p ~/mmc-shots && cp ios/tools/screenshots/shots.js ~/mmc-shots/
#   bash ios/tools/screenshots/capture.sh <device-udid> iphone-6.9 [270|90]
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
# Info.plist locks iPhone to landscape, so on a phone the app already opens the
# right way round and the rotation below is belt and braces. iPad still allows
# all four, so it is the one that needs it. There is no `simctl` verb for
# rotation and it goes through the Simulator app's own menu command, which can
# silently do nothing -- hence the pixel dimensions printed at the end. Wider
# than it is tall, or the shots are of the wrong layout.
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
# Clockwise degrees to rotate a portrait frame holding a landscape-locked app.
# 270 or 90; see the note beside the rotation below for why this is not decided
# for you.
ROT="${3:-270}"
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

# Rotate the simulator to landscape, so the DEVICE frame matches the app.
#
# This fails over SSH and says so: "osascript is not allowed to send
# keystrokes", because System Events needs accessibility permission granted to
# whatever drives it, and a remote shell has none. Left in because it works
# from the Mac's own terminal, and harmless when it does not: the app is
# landscape-locked, so it lays out correctly either way and only the device
# frame is portrait. The step after the shots fixes that case.
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

# A portrait frame means one of two completely different things, and rotating
# the file is right for exactly one of them.
#
# Where the app is landscape-LOCKED, the game laid out landscape inside a
# portrait device frame: the pixels are right and the image is merely on its
# side, so rotating it is honest -- nothing is redrawn, resampled or
# recomposited. 270 clockwise brings the right edge, where the HUD ends up, to
# the top.
#
# Where the app also supports portrait, a portrait frame means it LAID OUT
# portrait, and rotating that gives a portrait screenshot lying on its side
# with every line of text running vertically. That happened, and it looked
# plausible enough in a file listing to nearly ship. So the app's own
# Info.plist decides, per device family, rather than the pixel dimensions.
case "$NAME" in
  ipad*) ORIENT_KEY="UISupportedInterfaceOrientations~ipad" ;;
  *)     ORIENT_KEY="UISupportedInterfaceOrientations" ;;
esac
PORTRAIT_OK=$(/usr/libexec/PlistBuddy -c "Print :$ORIENT_KEY" "$APP/Info.plist" 2>/dev/null   | grep -c Portrait || true)

W=$(sips -g pixelWidth "$OUT"/1-title.png | awk '/pixelWidth/{print $2}')
H=$(sips -g pixelHeight "$OUT"/1-title.png | awk '/pixelHeight/{print $2}')
if [ "$W" -lt "$H" ]; then
  if [ "$PORTRAIT_OK" -eq 0 ]; then
    # Which of the two landscape orientations the app lands in is not ours to
    # choose and not visible from here: a run can come back either way up, and
    # one did. So the direction is an argument with a default, and the script
    # says so rather than implying it knew. Look at the result; if it is upside
    # down, re-run with 90.
    echo "  device frame came back portrait and the app is landscape-locked;"
    echo "  rotating ${W}x${H} by ${ROT} degrees clockwise"
    echo "  CHECK IT IS THE RIGHT WAY UP -- if not, re-run with 90 as the third argument"
    for f in "$OUT"/*.png; do sips -r "$ROT" "$f" >/dev/null; done
  else
    echo "  WARNING: these are PORTRAIT layouts, not landscape ones lying down."
    echo "  $ORIENT_KEY allows portrait, so the app laid out portrait and"
    echo "  rotating them would produce sideways text. Rotate the simulator and"
    echo "  re-run, which needs the Mac's own terminal: sending the keystroke"
    echo "  from ssh is refused by System Events."
  fi
fi

# Landscape means width greater than height. Whatever else looks right, if this
# prints a portrait pair the shots are of the wrong layout.
sips -g pixelWidth -g pixelHeight "$OUT"/1-title.png | tail -2
ls "$OUT"

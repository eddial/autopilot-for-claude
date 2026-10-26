#!/bin/zsh
# Poses the iPhone Duo simulator: duo.sh <outer|inner> [portrait|landscape-left|landscape-right]
# Builds scripts/fold.m once (the hinge event Device Hub's own controls send) and runs it inside
# the booted Duo. Screenshots then follow whichever display is lit.
set -e
here=${0:A:h}
bin=${TMPDIR:-/tmp}/autopilot-duo-fold
[[ $bin -nt $here/fold.m ]] || {
  xcrun -sdk iphonesimulator clang -arch arm64 -mios-simulator-version-min=17.0 -O2 -fobjc-arc \
    -o $bin $here/fold.m -framework IOKit -framework Foundation
  codesign -f -s - $bin 2>/dev/null
}
udid=$(xcrun simctl list devices booted | grep -m1 'iPhone Duo' | grep -oE '[0-9A-F-]{36}')
[[ -n $udid ]] || { echo "no booted iPhone Duo"; exit 1; }
xcrun simctl spawn $udid $bin angle $([[ $1 == outer ]] && echo 0 || echo 180)
[[ -n $2 ]] && xcrun simctl spawn $udid $bin orient $2
echo "$1 ${2:-}"

#!/usr/bin/env bash
# Builds Pahunch.apk with the plain Android SDK tools (no Gradle): aapt2 -> javac -> d8 -> zipalign -> apksigner.
# Used by .github/workflows/android.yml. Needs ANDROID_HOME, a JDK, and KS (keystore path) + KS_PASS.
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-$ANDROID_SDK_ROOT}
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLATFORM=$(ls "$SDK/platforms" | grep -E '^android-[0-9]+$' | sort -V | tail -1)
JAR="$SDK/platforms/$PLATFORM/android.jar"
echo "build-tools: $BT · platform: $PLATFORM"
rm -rf build && mkdir -p build/gen build/classes build/dex
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen build/res.zip
javac -source 11 -target 11 -encoding UTF-8 -Xlint:-options -cp "$JAR" -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --min-api 26 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../base.apk classes.dex)
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-key-alias pahunch --ks-pass env:KS_PASS --key-pass env:KS_PASS --out build/Pahunch.apk build/aligned.apk
"$BT/apksigner" verify build/Pahunch.apk
ls -l build/Pahunch.apk

#!/usr/bin/env bash
# Builds Storant for Android inside Docker. Output: /out/storant-<version>.apk and .aab
#
# Signing: a release keystore (storant-release.jks; an old Tallyko-era release.jks is left untouched and unused) is created on first run and kept in the "android_keystore" Docker volume.
# BACK IT UP (docker compose --profile android run --rm android-build backup-keystore) — every future
# update must be signed with the same key or phones will refuse to install it.
set -euo pipefail

SRC=/workspace/src
APP=/workspace/app
KEYDIR=/keystore
OUT=/out

if [[ "${1:-}" == "backup-keystore" ]]; then
  cp "$KEYDIR/storant-release.jks" "$KEYDIR/storant-keystore.properties" "$OUT/" && echo "Keystore copied to ./dist — store it somewhere safe and private."
  exit 0
fi

echo "==> Copying sources"
rm -rf "$APP" && mkdir -p "$APP"
(cd "$SRC" && tar --exclude=node_modules --exclude=android --exclude=ios --exclude=.expo --exclude=dist -cf - .) | (cd "$APP" && tar -xf -)
cd "$APP"

echo "==> Installing JS dependencies"
npm ci --no-audit --no-fund

echo "==> Preparing signing key"
mkdir -p "$KEYDIR"
if [[ ! -f "$KEYDIR/storant-release.jks" ]]; then
  PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  keytool -genkeypair -v -keystore "$KEYDIR/storant-release.jks" -alias storant -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Storant, OU=POS, O=Storant, C=IN" > /dev/null
  printf 'storePassword=%s\nkeyPassword=%s\nkeyAlias=storant\n' "$PASS" "$PASS" > "$KEYDIR/storant-keystore.properties"
  chmod 600 "$KEYDIR/storant-release.jks" "$KEYDIR/storant-keystore.properties"
  echo "    Created a NEW release keystore: storant-release.jks. BACK IT UP NOW:"; echo "      docker compose --profile android run --rm android-build backup-keystore   (copies it to ./dist)"
fi
# shellcheck disable=SC1090
source <(sed 's/^/export KS_/' "$KEYDIR/storant-keystore.properties")

echo "==> Generating native Android project (expo prebuild)"
npx expo prebuild --platform android --clean --no-install

echo "==> Configuring release signing"
python3 - "$KEYDIR/storant-release.jks" <<'PY'
import re, sys, os
path = "android/app/build.gradle"
src = open(path).read()
release = f'''
        release {{
            storeFile file("{sys.argv[1]}")
            storePassword System.getenv("KS_storePassword")
            keyAlias System.getenv("KS_keyAlias")
            keyPassword System.getenv("KS_keyPassword")
        }}'''
if "signingConfigs.release" not in src:
    src = re.sub(r"(signingConfigs\s*\{)", r"\1" + release, src, count=1)
    # Point the release build type at the release key (Expo templates default it to the debug key)
    src = re.sub(r"(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug", r"\1signingConfig signingConfigs.release", src, count=1, flags=re.S)
open(path, "w").write(src)
PY
grep -q "signingConfig signingConfigs.release" android/app/build.gradle || { echo "Could not configure release signing"; exit 1; }

VERSION=$(node -p "require('./app.json').expo.version")
CODE="${APP_VERSION_CODE:-1}"
sed -i "s/versionCode [0-9]*/versionCode $CODE/" android/app/build.gradle

echo "==> Building release APK + AAB (this takes a while the first time)"
cd android
./gradlew --no-daemon assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
cd ..

mkdir -p "$OUT"
APK=android/app/build/outputs/apk/release/app-release.apk
AAB=android/app/build/outputs/bundle/release/app-release.aab
cp "$APK" "$OUT/storant-$VERSION.apk"
cp "$AAB" "$OUT/storant-$VERSION.aab"

echo "==> Checking 16 KB page-size alignment (required by Google Play)"
if zipalign -c -P 16 -v 4 "$OUT/storant-$VERSION.apk" > /tmp/align.log 2>&1; then
  echo "    16 KB alignment: OK"
else
  echo "    WARNING: 16 KB alignment check failed — see below"; tail -20 /tmp/align.log
fi

echo
echo "Done:"
echo "  $OUT/storant-$VERSION.apk  -> share and install on Android phones/tablets"
echo "  $OUT/storant-$VERSION.aab  -> upload to Google Play Console"

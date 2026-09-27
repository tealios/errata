# Android

Errata runs fully offline on Android. The APK carries the same Nitro server bundle the
desktop and binary builds use, executed on-device inside an embedded Node.js runtime,
and the app's WebView talks to it over loopback. No PC, no remote server, no account.

## How it fits together

```
android/                        Capacitor project (committed; edit like any Android app)
capacitor.config.ts             appId, webDir, plugin config
mobile/
  shell/index.html              loader page the WebView boots into
  shell/webspeech-shim.js       speechSynthesis on Android TTS (injected by MainActivity)
  node/main.cjs                 entry the embedded Node runtime executes
  node/boot.cjs                 polyfills, env, health polling (unit-tested)
  www/                          generated: loader + nodejs/ project (gitignored)
scripts/build-android.mjs       vite build -> assemble mobile/www -> cap sync
```

Launch sequence:

1. Capacitor shows `mobile/www/index.html` (parchment "Opening the library…").
2. The Node.js plugin (`@capawesome/capacitor-nodejs`, Node 18.20.4) starts
   `nodejs/main.cjs` from the same web directory.
3. `main.cjs` sets `DATA_DIR` to the app's private files directory, installs the polyfills
   Node 18 lacks, imports `server/index.mjs`, and polls `/api/health`.
4. When healthy it posts `errata:status { status: 'ready', url }` over the plugin bridge
   and the loader does `location.replace('http://127.0.0.1:7739/')`.

From then on the WebView is just a browser pointed at a local Errata. Everything the
web app does (generation, librarian, TTS via WASM, plugins) works as on desktop.

One gap is patched natively: the Android System WebView has no Web Speech API, so the
"Browser" read-aloud engine had nothing to call. `MainActivity` exposes Android's
TextToSpeech as `window.ErrataNativeTts` (`NativeTts.java`) and injects
`mobile/shell/webspeech-shim.js` at document start on the app origin, which builds
`speechSynthesis` / `SpeechSynthesisUtterance` on top of it. The web app is unchanged and
the voice picker lists the phone's installed voices. Android TTS cannot pause, so pause
stops and resume restarts the current sentence-sized chunk.

## Prerequisites

The Node runtime is compiled C++ (libnode) plus a small JNI bridge, so the build needs
the native toolchain in addition to the usual Android bits.

- Android Studio (Ladybug 2024.2.1 or newer) with SDK Platform 36
- JDK 21 (Android Studio's bundled JBR is fine; set `JAVA_HOME` if building from a shell)
- NDK and CMake 3.22+ (SDK Manager > SDK Tools)
- Bun, as for the rest of the repo

First Gradle build downloads the Node.js for Mobile Apps binaries (~100 MB) into the
Gradle cache. That only happens once per runtime version.

## Building

```bash
bun run android:assemble        # vite build, assemble mobile/www, cap sync android
bun run android:open            # same, then open android/ in Android Studio
bun run android:apk             # same, then gradle assembleDebug
```

Flags on the underlying script:

```bash
bun scripts/build-android.mjs --skip-build   # reuse .output from an earlier build
bun scripts/build-android.mjs --no-sync      # assemble only, no cap sync
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Install
with `adb install -r <apk>` or run from Android Studio with a device attached.

Release builds use the normal Android flow: create a signing config in
`android/app/build.gradle` (or Android Studio > Build > Generate Signed Bundle), then
`gradlew assembleRelease` or `bundleRelease` for the Play Store.

## Where data lives

`app.datadir()` from the plugin bridge, which is the app's private files directory
(`/data/user/0/com.tealios.errata/files`):

| Path                | Contents                                         |
| ------------------- | ------------------------------------------------ |
| `files/data/`       | `config.json`, `stories/<id>/`, logs. Same layout as `DATA_DIR` on desktop. |
| `files/plugins/`    | External plugins (`PLUGIN_DIR`). Drop a plugin folder here to load it. |

Uninstalling the app deletes both. Back up with Android's app backup or by exporting
stories from within Errata.

## Limitations

- **Node 18 runtime.** The server bundle targets newer Node; `boot.cjs` polyfills
  `Promise.withResolvers` and the global `crypto`. If a dependency starts needing
  something else from Node 20+, add it there. `tests/android/boot.test.ts` covers the
  polyfills and `tests/server-portability.test.ts` fails if Bun-only APIs creep into
  the server.
- **No child processes.** Node.js for Mobile Apps cannot spawn. Cloudflare tunnel
  sharing (which spawns `cloudflared`) does not work; LAN sharing over the device's
  Wi-Fi address does.
- **Single runtime per launch.** The Node engine cannot be restarted. If the server
  fails to start, the loader shows the error and asks the user to force-close and
  relaunch.
- **Size.** libnode is roughly 30 MB per ABI. The APK includes armeabi-v7a, arm64-v8a
  and x86_64; use an App Bundle for the Play Store so devices get one.
- **No ICU in the runtime.** Node.js for Mobile Apps ships without Intl and without
  Unicode property escapes in regexes. `boot.cjs` wraps `RegExp` so patterns built with
  `\p{...}` (the OpenAPI plugin does this at import time) degrade to "any non-ASCII"
  instead of crashing. `Intl` is simply undefined; server code must not rely on it.
- **Patched plugin.** `patches/@capawesome%2Fcapacitor-nodejs@0.1.1.patch` makes the
  plugin's started/ready flags static. Without it, Android recreating the activity
  (Back at the root, then relaunch) starts libnode a second time in the same process
  and the app crashes. Bun applies the patch on install; keep it until upstream fixes it.
- **Background.** Android may pause the runtime when the app is backgrounded. The
  entry releases the pause lock immediately; in-flight generations resume with the app.

## Troubleshooting

- *Blank or white screen after "Ready."* The WebView refused the cleartext hop to
  `http://127.0.0.1`. Check `android/app/src/main/res/xml/network_security_config.xml`
  is referenced from the manifest and permits cleartext for `127.0.0.1`.
- *"Errata could not start" with a module error.* Usually a Node 18 gap. Reproduce on a
  desktop with real Node 18: write a preload that requires `mobile/node/boot.cjs`, calls
  `installPolyfills()` and applies `buildServerEnv(tmpDir)` to `process.env`, then run
  `npx -p node@18.20.4 node -r ./preload.cjs .output/server/index.mjs`. Extend
  `installPolyfills` for whatever fails.
- *Gradle: `LIBNODE_DIR must be defined` or CMake missing.* Install NDK + CMake through
  SDK Manager and sync again.
- *Old assets after a rebuild.* `scripts/build-android.mjs` wipes `mobile/www` each run,
  but Android Studio may cache; use Build > Clean Project.

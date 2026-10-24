# Texite Android 0.1.0 alpha

## Architecture

- Capacitor 8 Android shell; app id `com.texite.android`, separate from desktop.
- Dedicated React touch workspace reuses SourceEditor, PDF.js, diagnostic parser,
  ZIP format and Project model. Phone uses editor/preview tabs; tablet uses split view.
- Native `TexiteFiles` plugin uses Android AtomicFile in `files/projects` for
  serialized durable saves. SAF exports ZIP/PDF through the system document picker.
  Browser development preview uses IndexedDB. No broad storage permission.
- A disposable Web Worker runs bundled BusyTeX pdfLaTeX (TeX Live 2023), matching
  package bundles and CJK/Arphic fonts. BibTeX and bounded cross-reference passes
  run locally. Cancellation/timeout terminates the worker. Runtime never downloads.
- Android assets are separate from desktop and copied only in Android build mode.

## Build

Requires Node 22+, pnpm, Python, JDK 21, Android SDK 36 and build tools. Set
`JAVA_HOME` and `ANDROID_HOME`, or use the project-local `.tools` layout.

1. `pnpm install --frozen-lockfile`
2. `pnpm runtime:prepare` (or provide the existing modular runtime)
3. `pnpm android:runtime`
4. `pnpm dist:android`

Output: `release/android/Texite-0.1.0-alpha.1-debug.apk`. This is a debug-signed
test build, not a Play Store release. Preserve the same signing key for updates.
No Release publication occurs in these commands.

`pnpm dev:android` serves `/android.html`. Run
`pnpm build:android` followed by
`pnpm exec playwright test -c playwright.android.config.ts` for mobile layout,
persistence, Chinese/English offline compilation, bibliography, failure and cancellation checks.
Tests use the production bundle, with no development hot reload. The optional
`Package Android alpha` GitHub Actions workflow builds APK artifacts without publishing a Release.

## Current boundaries

First version supports project creation, ZIP import/export, files/folders, source
editing/search/undo, image/PDF preview, local pdfLaTeX, diagnostics and appearance.
AI, WebDAV, desktop history/backup UI and Visual editing have not been ported.
Chinese uses CJKutf8; fontspec/XeLaTeX and Biber are not supported. The embedded
TeX Live year differs from desktop; documents requiring newer macros may fail.
Full TeX Live is intentionally not included. See `android-runtime-notices.md`.

App updates retain private files. Android uninstall or clear-app-data deletes
them: export ZIP first. Automatic OS cloud backup is disabled. No API keys or
cloud connections are present in this initial Android implementation.

Test devices need a current Android System WebView. Native file picker, system
back, keyboard/insets and memory use still require verification on physical
devices before a production release.

Goal: migrate HavenOS from web to a native Expo app by following the expo-web-to-native skill, one screen per iteration, until done.

Each iteration, FIRST re-read the playbook - the expo plugin's skills/expo-web-to-native/SKILL.md (and its references) - then:
1. Open mobile/migration-progress.md and take the top unchecked item under
   "nativize-now"; if none are left unresolved (every nativize-now is done or
   blocked), STOP and summarize what shipped + what's blocked and why.
2. Redesign that screen native per the skill's step 4 — reach for @expo/ui FIRST
   (real SwiftUI/Compose), then expo-router (NativeTabs, large titles);
   RN primitives only for custom layouts. NEVER a webview port.
   Reuse src/native/ui.tsx, src/native/use-core.ts (useCore = the desktop's useApi
   over the on-device core) and the shared formatters in ../lib/domain and ../lib/i18n.
   Match the desktop screen's content and behavior (read its page in ../app).
3. Verify in the iOS Simulator: More → Use sample workspace, open the route,
   compare content against the DOM version of the same screen. Run
   `npx tsc --noEmit`. If it's off for reasons IN the code, fix it this iteration.
   If blocked OUTSIDE the code, mark it blocked in step 4 and move on.
4. Check the item off in mobile/migration-progress.md, appending one line:
   "<screen> — done", or "<screen> — blocked: <reason> — needs <what would unlock>".
   Delete the screen's now-unused DOM entry in src/dom/pages.

Rules: one screen per pass; the app builds green each iteration; @expo/ui before RN primitives; never touch "nativize-later" items; never change ../desktop/core behavior.
Base API URL for native: none — the core runs on the device (src/core/host.ts).

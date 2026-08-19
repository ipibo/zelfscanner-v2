# Kiosk Mode Research — MC18N0 + PS20J (2026-08-19)

## TL;DR
- **ps1 (PS20J, Android 10):** solved. Finish Device Owner lock-task. No shade/recents peek problem. Clean native kiosk.
- **mc1 (MC18N0, Android 5.1):** firmware ceiling is real. Recents-button and full status-bar suppression are **impossible via MX** on Lollipop (OSX version floor, not a config bug). Best path = on-device overlay + immersive-sticky + reactive AccessibilityService. EHS won't beat the ceiling (it sits on the same MX).
- Do first (cheap, today): read exact **OSX** version on mc1. NavigationBarUsage floor is OSX 6.2 — if a LifeGuard update reaches it, you get free nav-bar removal.

---

## Hard constraints (confirmed this session)
| # | Constraint | Source |
|---|-----------|--------|
| HC1 | adb root blocked on MC18N0 production build. No remount, no `/system` push. | "adbd cannot run as root", no public userdebug BSP |
| HC2 | `RecentAppButtonUsage` needs **OSX 7.2**. MC18N0 Lollipop never ships OSX 7.2 → dead forever on mc1. | Zebra UiMgr TechDocs |
| HC3 | `NavigationBarUsage` needs **OSX 6.2** (MX 7.1). Device currently rejects → its OSX is <6.2. Maybe reachable via LifeGuard (unverified). | Zebra UiMgr TechDocs |
| HC4 | `StatusBarUsage` needs OSX 8.1 / API 27. Impossible on Lollipop. | Zebra UiMgr TechDocs |
| HC5 | `HomeKeyUsage` (OSX 1.0) + `NotificationPullDown` (OSX 5.1) work on mc1 — already proven. | Zebra UiMgr TechDocs + your test |
| HC6 | EHS max on Lollipop = **v2.8**. EHS is built on MX → same OSX floors. Won't fix recents/status-bar peek. Free. | Zebra EHS release notes |
| HC7 | AccessibilityService on API 22 = **reactive only**. No `dispatchGesture` (API 24+), no touch consume. Can auto-dismiss shade/recents, can't pre-empt. | AOSP API history |
| HC8 | `startLockTask`/`setLockTaskFeatures` absent from API 22 framework.jar. `shareUserId=android.uid.system` needs the ROM platform key (not ours). Native lock-task dead on mc1. | AOSP + signing model |
| HC9 | StageNow vs EMDK: version negotiation is device-side. Same CSPs, same floors, **no hidden params**. StageNow only helps persistence, not capability. | MX architecture |
| HC10| ps1 (Android 10) = full AOSP. Device Owner lock-task suppresses shade+recents fully. No peek problem. | AOSP |

**Net for mc1:** HOME + notification-pulldown blockable. Recents button + full status bar = never (firmware). Edge-swipe peek = not preventable via MX. Must solve peek at app layer.

---

## Ranked approaches (mc1)

### 1. Overlay-blocker + immersive-sticky + reactive AccessibilityService — **DO THIS**
The only path that actually contains the swipe-peek on Lollipop without root.
- **Stack:**
  1. Activity in `IMMERSIVE_STICKY | HIDE_NAVIGATION | FULLSCREEN` (API 19+). Hides both bars; edge-swipe only shows translucent transient bars.
  2. `TYPE_SYSTEM_OVERLAY`/`TYPE_SYSTEM_ERROR` window (SYSTEM_ALERT_WINDOW perm) as a thin touch-eating strip over the status-bar zone → kills the pull-down at its swipe origin.
  3. AccessibilityService watches `TYPE_WINDOW_STATE_CHANGED`/`TYPE_WINDOWS_CHANGED`; if shade or recents appears, fire `GLOBAL_ACTION_BACK` / relaunch kiosk activity → auto-dismiss.
- **Pros:** no root, no system app, works API 22 today. Layers cover each other's gaps.
- **Cons:** overlay strip is OEM-finicky (verify coverage on device); reactive dismiss = brief flicker if a gesture slips through; SYSTEM_ALERT_WINDOW auto-granted pre-M so fine on 5.1.
- **Go/no-go:** on device, swipe from top edge — does overlay eat the swipe? Does shade fail to fully open, or get auto-collapsed within ~100ms? If yes → ship.
- **Complexity:** medium. ~2–3 focused sessions.

### 2. LifeGuard update → unlock NavigationBarUsage — **CHEAP TEST FIRST**
- **Action:** read current MX + OSX version via EMDK (`Version` in UiMgr result / RE Manager). Apply latest MC18N0 Lollipop LifeGuard (BSP 02.09.02 + latest LG patch). Re-read OSX. If OSX ≥ 6.2 → `NavigationBarUsage=2` now accepted = nav bar gone entirely.
- **Pros:** removes BACK/HOME/RECENTS soft keys in one CSP if it lands. Trivial if version reaches floor.
- **Cons:** likely Lollipop never reaches OSX 6.2 (unverified — that's the test). Does nothing for recents-peek/status-bar. Doesn't replace #1.
- **Go/no-go:** OSX ≥ 6.2 after update = yes; else drop.
- **Complexity:** low. One session (mostly flashing + a query).

### 3. EHS 2.8 as locked launcher — belt-and-suspenders
- **What it buys:** replaces home launcher, app whitelist, auto-relaunch on focus loss, config lock. Your app runs as the whitelisted foreground app inside EHS.
- **What it does NOT buy:** it's built on MX → same OSX floors → will **not** block recents/status-bar any better than #1. It is *not* the magic kiosk fix.
- **Pros:** free on Zebra, official, robust relaunch/whitelist, survives reboot.
- **Cons:** doesn't solve peek; adds a component; still needs #1 for gesture containment.
- **Go/no-go:** want a hardened relaunch/whitelist layer? add it. Need it to fix swipe? no.
- **Complexity:** low-medium (StageNow config).
- **Model:** EHS is the launcher; your app is whitelisted inside it (you don't rewrite your app as EHS).

### 4. adb root / system-app / signature-perm — **NO. DEAD.**
- Production build blocks root (HC1). Can't remount `/system`. Can't push system app. `shareUserId=system` needs the platform key (HC8). Even with it, API 22 framework.jar lacks the methods (HC8). No quick test will change this. Stop.

### 5. StageNow-only CSP hunt — **NO.**
- Same CSPs/versions as EMDK (HC9). No hidden swipe/gesture params. Use StageNow only for reboot-persistent provisioning, not for new capability.

### 6. Force gesture-nav to re-bind swipes — **N/A on mc1.**
- Gesture nav is Android 10+. MC18N0 Lollipop has none. Moot. (On ps1 it exists but lock-task already handles it.)

---

## ps1 (PS20J, Android 10) — finish the clean path
- Device Owner already added (commit a2fbcd7). With DO: `setLockTaskPackages(...)` + `setLockTaskFeatures(LOCK_TASK_FEATURE_NONE)` + `startLockTask()`.
- Android 10 lock-task genuinely disables shade + recents + home. **No swipe-peek problem.**
- **Go/no-go:** in lock-task, swipe top edge → shade must not open; hold recents → nothing. If clean → ps1 done.
- The mc1≠ps1 gap is firmware-driven and unavoidable. ps1 = native kiosk; mc1 = overlay/accessibility hack stack. Accept the gap.

---

## Execution order
1. **ps1:** verify Device Owner lock-task fully contains shade/recents. (cheap, likely already working)
2. **mc1, cheap test:** read OSX version, apply latest LifeGuard, retest `NavigationBarUsage=2`. Keep if OSX ≥ 6.2.
3. **mc1, real fix:** build overlay + immersive-sticky + reactive AccessibilityService (#1).
4. **mc1, optional hardening:** wrap in EHS 2.8 for relaunch/whitelist.
5. **Drop:** root, system-app, StageNow-magic, gesture-nav rebind.

## Sources
- [Zebra UiMgr TechDocs (version floors)](https://techdocs.zebra.com/mx/uimgr/)
- [EHS About / release notes](https://techdocs.zebra.com/ehs/2-7/guide/features/)
- [EHS downloads & Lollipop support](https://www.zebra.com/us/en/support-downloads/software/mobile-computer-software/enterprise-home-screen.html)
- [MC18 L OS update / BSP](https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/release-notes/mc18-l-os-update-instructions.pdf)
- [42Gears: hide nav bar / disable recents on Zebra](https://knowledgebase.42gears.com/article/how-to-hide-navigation-bar-and-disable-recent-apps-on-zebra-devices/)

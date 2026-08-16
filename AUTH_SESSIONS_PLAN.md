> Mirrored from `mdcard/AUTH_SESSIONS_PLAN.md` (sibling repo) so a session
> opened only in `mdcard-panel` still has the full plan. If the two copies
> drift, the one with the most recently updated checklist is authoritative —
> reconcile the other from it.

# Auth Refactor: JWT → Device Sessions + Business API Keys

Status: **Phases 1, 2, 3, and 4 all have code landed (not deployed)**.
Android's Play Integrity path is for-real implemented (server + mobile, other
repo) but **not yet confirmed against a real device** — an SDK-54-vs-57
incompatibility blocked that test, and the fix (SDK upgrade) hasn't had a
fresh dev-client rebuild + device test yet. iOS App Attest server-side
verification is still a stub (Phase 5). **Do not deploy this to production
yet — see the "Before this can ship" note below**, a real breaking issue was
found while implementing.

Phase 3 (mobile, other repo) uncovered that the real device-attestation API
(`@expo/app-integrity`, Expo's own module) has a different shape than this
doc originally assumed — notably iOS's attest-once/assert-thereafter flow.
Phase 1's server contract (`mdcard/server`) was corrected in the same session
to match (see §6) rather than shipping mobile code against a fictional
contract.

**Update**: real Android verification is now implemented (not just a stub) —
`mdcard/server/services/playIntegrity.js` calls Google's `decodeIntegrityToken`
for real, and the mobile app was upgraded from Expo SDK 54 to 57 because
`@expo/app-integrity` has never published a version compatible with SDK 54
(confirmed via npm's full version history — it starts at `56.0.0`). Testing
this on a real Android device also surfaced and fixed a real bug: the server
was comparing Google's echoed request hash against the wrong value (the
JWT's inner `nonce` claim instead of the outer `challenge` string the mobile
app actually binds into the attestation request) — see §6.
This file is the working spec for a multi-session refactor. Update the checklists
as work lands; keep decisions here in sync with what actually gets built — if an
implementation session deviates from this doc, edit the doc in the same session.

## ⚠ Before this can ship: existing business-partner impact

`mdcard/server/docs/openapi.js` (the third-party business-partner API docs)
currently documents `POST /login` with phone+password as *the* way a business
partner authenticates their integration and gets a bearer token. Phase 1 makes
`/login` require phone device attestation — something a server-side
integration fundamentally cannot provide, since it isn't a phone. **Any
existing business partner authenticating this way will break the moment this
deploys**, with no replacement available until Phase 2's API keys can
actually be issued (Phase 4 — this repo's admin UI) and each partner is
migrated to one.

Before deploying Phase 1: confirm whether any real production business
partners currently integrate via `POST /login`, and if so, migrate them to an
API key *before* Phase 1 goes live — not after. Update: this repo's Phase 4 is
fully landed (backend + admin UI), so an admin can issue a key from the user
detail page's "مفاتيح API" section without touching the API directly. Also
means `mdcard/server/docs/openapi.js` needs an update (Phase 5, in the other
repo) pointing business partners at API-key auth instead of `/login` once
existing partners are migrated.

This plan spans **two separate git repositories**:
- `mdcard/` (sibling repo) — `server/`, `client/`, `mdcard-mobile/`
- `mdcard-panel/` (this repo) — admin dashboard, own Express server with
  **direct MongoDB access to the same database** (it already duplicates models
  like `CardCategory` rather than calling the main API — follow that existing
  pattern for `Session`/`ApiKey` too, see Phase 4).

---

## 1. Requirements (as given by the user)

- Replace JWT access tokens with **server-side sessions** so each login is a
  distinct, trackable, revocable "device".
- **Business accounts**: up to **2 concurrent sessions**. Sessions may be Android
  or iOS. Business accounts can *additionally* authenticate via an **API key**
  for programmatic/server-to-server access.
- **Individual accounts**: up to **5 concurrent sessions**. Android or iOS.
  Individual accounts **cannot** have an API key at all.
- **API keys**:
  - Only usable by business accounts.
  - Cannot be used from the mobile app (the app never holds one).
  - Restricted to "authorized users only" — issuance is gated, not open self-serve.
- Sessions and API keys are mutually exclusive credential types: a session token
  only ever works as a session, an API key only ever works as a key. Neither
  substitutes for the other.
- A session may only be created if it's proven to originate from a real phone:
  **Play Integrity API** (Android) or **App Attest / DeviceCheck** (iOS).
- The `mdcard-panel` admin dashboard must be updated to manage this: viewing/
  revoking a user's sessions, issuing/revoking business API keys.

## 2. Decisions confirmed with the user

| Question | Decision |
|---|---|
| Are business sessions Android-only? | **No** — business and individual both allow Android (Play Integrity) or iOS (App Attest); the only difference is the cap (2 vs 5), not OS. |
| What happens at the session cap? | **Evict the least-recently-used session** automatically on new login (no hard block). |
| What is the API key for? | **Same REST endpoints as the mobile app**, just a second auth method for server-to-server use — not a separate route surface. |
| Rollout / migration strategy vs. the live app? | **Not a concern right now** — design the end state cleanly; no dual JWT+session transition period needs to be engineered. |

## 3. Open decisions (assumed defaults — revisit before/while building)

These weren't asked about explicitly; each has a default baked into this plan.
Flag to the user if a session touches one and the default seems wrong.

- **API key issuance is admin-only** (via mdcard-panel), not self-service by the
  business user. Matches "restricted to authorized users only" read literally.
- **A business account may hold multiple named API keys** (e.g. one per
  integration), default soft cap of 5, independent of the 2-session cap.
- **Session token transport**: `Authorization: Bearer <opaque token>`, same as
  today's JWT — mobile already stores the token in SecureStore and sends it this
  way (`mdcard-mobile/services/api.js`), so no transport-layer change needed.
- **Push tokens move from per-user to per-session** is *not* required by this
  refactor and is left as a future nice-to-have (Phase 5), since `pushTokens`
  on `User` works independently of how the access token is issued.
- **Session/attestation records do not block on this repo having Google/Apple
  credentials available** — Phase 1 lands the plumbing with a pluggable verifier
  interface; wiring real Play Integrity / App Attest calls needs a Google Cloud
  service account and Apple Developer enrollment, which are account/infra
  prerequisites outside of code (see §7 prerequisites).

## 4. Target architecture

Two independent, mutually exclusive credential types on `server/`:

| | Session | API key |
|---|---|---|
| Who | any user (business or individual), via mobile app | business only |
| Issued by | login + device attestation | admin (mdcard-panel), gated |
| Cap | 2 (business) / 5 (individual), LRU-evicted | ~5 named keys (soft default) |
| Requires phone attestation | yes (Play Integrity / App Attest) | no |
| Token shape | opaque `sess_<random>` | opaque `mdc_live_<random>` |
| Storage | SHA-256 hash only, in `Session` collection | SHA-256 hash only, in `ApiKey` collection |
| Transport | `Authorization: Bearer <token>` | `Authorization: Bearer <token>` |
| Revocable | per-device, from mobile app or admin panel | per-key, from admin panel |

The mutual exclusivity ("API keys can't be used by the app, sessions can't be
used as API access") is enforced **structurally by possession**, not by
sniffing User-Agent (which is spoofable and not a real control): the mobile app
is simply never given a key, and keys are only ever handed out by an admin to a
business integration. The auth middleware still distinguishes the two by token
prefix so route-level policy (`requireSession` vs. `requireAuth`) can apply
where it matters (e.g. device/session-management endpoints must be
session-only — an API key holder shouldn't be able to list or revoke someone's
phone sessions).

Non-goals: JWTs remain fine for what they're *not* being asked to replace —
short-lived phone-verification codes and password-reset tokens
(`auth.controller.js`) are single-use, minutes-to-hours lived, and unrelated to
"who is currently logged in." Leave those as-is; only the **access token**
(the thing that replaces `req.user` on every authenticated request) changes.

## 5. Data model changes (`server/models/`)

### `session.model.js` (new)
```js
{
  user: ObjectId (ref User, indexed),
  tokenHash: String (sha256 of opaque token, unique, indexed),
  platform: "android" | "ios",
  deviceId: String,       // stable per-install id sent by the app
  deviceName: String,     // optional, human-readable e.g. "Pixel 8"
  appVersion: String,
  attestation: {
    provider: "play_integrity" | "app_attest",
    verifiedAt: Date,
  },
  ip: String,
  createdAt: Date,
  lastUsedAt: Date,        // updated (throttled) on each authenticated request
  expiresAt: Date,         // absolute cap, mirrors today's 14d / 90d rememberMe
  revokedAt: Date | null,
}
```

### `apiKey.model.js` (new)
```js
{
  user: ObjectId (ref User, must have role "business"),
  name: String,             // admin-assigned label, e.g. "Acme Integration"
  keyHash: String (sha256, indexed),
  keyPrefix: String,        // first ~10 chars, unhashed, for display/lookup
  createdBy: ObjectId (ref Admin, from mdcard-panel),
  lastUsedAt: Date,
  revokedAt: Date | null,
  createdAt: Date,
}
```

### `user.model.js`
No schema change required. `role` already distinguishes business/individual,
which is all the cap and eligibility logic needs.

## 6. Server-side changes (`server/`, in `mdcard`)

### New/changed endpoints (under `/api/`)
- `POST /device-challenge` — public (rate-limited like login/signup), issues a
  short-TTL nonce the client embeds in its Play Integrity / App Attest request
  (prevents attestation replay). Implemented as a signed JWT carrying the
  nonce rather than a stored-challenge collection — stateless, same pattern
  already used for phone-verification tokens in this codebase. Lives in
  `auth.route.js` alongside `/login` etc. (not under an `/auth` prefix, to
  match how the rest of that file's routes are mounted directly under `/api/`).
- `POST /login` — now also accepts `{ platform, deviceId, deviceName,
  appVersion, challenge, ... }` plus platform-specific attestation fields
  (see §6 "Attestation verification" below for the exact shape); verifies
  attestation before issuing a session (not a JWT).
- `POST /verify-account`, `POST /reset-password/:token` — same change, they're
  also login-equivalent moments that currently hand back a JWT access token.
- `POST /logout` — revoke the current session.
- `POST /logout-all` — revoke every session for the current user ("log out of
  all devices").
- `GET /sessions` — list the current user's active sessions (platform, device
  name, created/last-used) for a "Manage devices" screen.
- `DELETE /sessions/:id` — revoke a specific session (remote sign-out).
- Everything else keeps its existing route/shape; only the auth layer underneath
  changes.

### New error codes (machine-readable, per this repo's `{ code }` convention)
`AUTH_SESSION_INVALID`, `AUTH_SESSION_EXPIRED`, `AUTH_SESSION_REVOKED`,
`AUTH_DEVICE_ATTESTATION_REQUIRED`, `AUTH_DEVICE_ATTESTATION_FAILED`,
`AUTH_DEVICE_CHALLENGE_EXPIRED`, `AUTH_API_KEY_INVALID`,
`AUTH_API_KEY_REVOKED`, `AUTH_API_KEY_NOT_ELIGIBLE` (individual role),
`AUTH_SESSION_ONLY_ENDPOINT` (API key used where a session is required).

### Middleware (`server/middleware/auth.middleware.js`)
Replace `verifyToken`/`getUserInfo` with token-prefix-aware resolution:
- Token starts with `mdc_` → API key path: hash, look up `ApiKey`, reject if
  revoked or owner isn't `role: "business"`, load user, `req.authMethod = "api_key"`.
- Otherwise → session path: hash, look up `Session`, reject if revoked/expired,
  touch `lastUsedAt` (throttled write), load user, `req.authMethod = "session"`.
- `requireAuth` — accepts either (used by the bulk of existing routes, matches
  the "same endpoints, alt auth" decision).
- `requireSession` — session only; use on `/sessions*`, push-token registration,
  and anything inherently device-scoped.
- Keep the existing inactive-user (`AUTH_USER_INACTIVE`) check in both paths.

### Session lifecycle helpers (`server/utils/session.js`, new)
- `createSessionToken()` / `hashToken()` — opaque token generation + SHA-256 hashing.
- `enforceSessionCap(userId, role)` — count active sessions, and if
  `count >= (role === "business" ? 2 : 5)`, revoke the one with the oldest
  `lastUsedAt` before the new session is written.
- Constants live in one place, e.g. `server/config/authLimits.js`:
  `SESSION_LIMITS = { business: 2, individual: 5 }`, `API_KEY_SOFT_CAP = 5`.

### Attestation verification (`server/services/`)

The mobile app talks to Expo's own unified module, **`@expo/app-integrity`**
(`npx expo install @expo/app-integrity`, real npm package, confirmed against
the installed `.d.ts` files — not a guess). Its two platforms are **not**
symmetric, and the server contract (`server/services/deviceAuth.js`) reflects
that:

- **Android (Play Integrity)** — a fresh check every login. Client calls
  `prepareIntegrityTokenProviderAsync(cloudProjectNumber)` once, then
  `requestIntegrityCheckAsync(challenge)` per login (the challenge is passed
  directly as the "requestHash" — Play Integrity treats that field as opaque
  bytes it just echoes back, so no on-device hashing/dependency is needed).
  Request body: `{ platform: "android", integrityToken }`.
  **`playIntegrity.js` now does real verification** (not a stub): calls
  Google's `decodeIntegrityToken` via `google-auth-library` (service account
  auth, `https://www.googleapis.com/auth/playintegrity` scope) and checks
  `tokenPayloadExternal.deviceIntegrity.deviceRecognitionVerdict` includes
  `MEETS_DEVICE_INTEGRITY`, `appIntegrity.appRecognitionVerdict ===
  "PLAY_RECOGNIZED"`, and — importantly — that
  `requestDetails.requestHash` equals the **outer `challenge` string**
  handed to the client, not the short `nonce` claim inside that challenge's
  JWT. (Those are two different values; comparing against the inner claim
  was a real bug that would have failed every real login — caught and fixed
  while wiring this up. `deviceAuth.js` now threads `challenge` through to
  both verifiers instead of the extracted `nonce`.) Needs
  `GOOGLE_PLAY_INTEGRITY_PACKAGE_NAME` (the app's package name) and
  `GOOGLE_PLAY_INTEGRITY_CREDENTIALS` (the full service-account JSON key, as
  one env var) set — a **dedicated** service account with only
  `roles/serviceusage.serviceUsageConsumer`, not the project's existing
  Firebase Admin SDK service account, to keep blast radius small if either
  key ever leaks.
- **iOS (App Attest)** — two-phase, driven by what the client already has
  stored locally:
  - First-ever login on a device: `generateKeyAsync()` → `keyId`, then
    `attestKeyAsync(keyId, challenge)` → `attestation`. Request body:
    `{ platform: "ios", keyId, attestation }`.
  - Every login after that (client already has `keyId` in SecureStore):
    `generateAssertionAsync(keyId, challenge)` → `assertion` (cheaper, no
    fresh attestation). Request body: `{ platform: "ios", keyId, assertion }`.
  - `appAttest.js` verifies whichever arrived (Phase 5: on `attestation`,
    verify with Apple and **persist the resulting public key keyed by
    `keyId`** — this needs a new collection, a device's App Attest key
    outlives any single `Session`, so it can't live on the Session document;
    on `assertion`, look up that stored key and verify the signature over the
    nonce, rejecting an unknown `keyId`). **This persistence layer does not
    exist yet** — flagged as a Phase 5 TODO in `appAttest.js`.
- Both still return `{ verified: true }` unconditionally in sandbox mode
  (mirrors `utils/sandbox.js`, lets the whole flow be exercised without real
  credentials). Outside sandbox: Android does the real check described
  above; iOS (`appAttest.js`) still fails closed with `APP_ATTEST_NOT_CONFIGURED`/
  `APP_ATTEST_NOT_IMPLEMENTED` until `APPLE_APP_ATTEST_TEAM_ID` is set and
  the real Apple verification call is written (Phase 5 — still needs the
  `AttestedKey` persistence layer too, see above).

## 7. Mobile app changes (`mdcard-mobile/`, other repo) — code landed, real credentials still needed

Turned out to be less of an infra spike than expected: the app already ships
with `expo-dev-client` and `eas build --profile development` scripts, and
Expo has an **official unified module for this exact purpose**,
`@expo/app-integrity` (installed, v57.0.1 — see §6 for its real API). No
custom native module had to be written.

What's landed:
- `services/deviceAttestation.js` (new) — wraps `@expo/app-integrity`,
  persists a device id and (on iOS) the App Attest `keyId` in SecureStore,
  and exposes `buildDeviceAttestation(challenge)` returning the right
  platform-specific fields. Includes a client-side sandbox bypass
  (`EXPO_PUBLIC_SANDBOX_MODE=true` env var, mirroring the server's flag) that
  sends dummy fields instead of calling the native module at all — this is
  what makes the flow testable today without any real Google/Apple setup.
- `services/authApi.js` — `login`/`verifyAccountByCode`/`resetPasswordByToken`
  now fetch `/device-challenge` and merge in `buildDeviceAttestation()`
  before sending. Added `logout()`/`logoutAll()`.
- `services/api.js` — response interceptor now treats
  `AUTH_SESSION_EXPIRED`/`AUTH_SESSION_REVOKED`/`AUTH_SESSION_INVALID` as a
  session-expired event globally (previously this was only checked ad hoc
  inside `verifyAccessToken`).
- `services/sessionsApi.js` (new) — `getSessions()` / `revokeSession(id)`.
- `app/profile/devices.jsx` (new) — "الأجهزة المسجلة" screen: lists sessions
  (platform icon, device name, last-active), marks the current device,
  lets you revoke any other one. Linked from the profile tab for **every**
  user (not business-gated, unlike printer settings). Registered in
  `app/_layout.jsx` with `headerShown: false` to match the other `profile/*`
  screens.
- `app/(tabs)/profile.jsx` — logout now calls the new `logout()` API
  (best-effort, still clears local state if the call fails) so signing out
  actually frees up a session slot instead of leaving it live until it
  naturally expires.
- `app/login.jsx`, `app/verify.jsx`, `app/reset-password.jsx` — added
  user-facing Arabic messages for the new `AUTH_DEVICE_ATTESTATION_FAILED` /
  `AUTH_DEVICE_CHALLENGE_EXPIRED` / `AUTH_DEVICE_ATTESTATION_REQUIRED` /
  `AUTH_DEVICE_PLATFORM_UNSUPPORTED` codes.
- `app.json` — added the iOS App Attest entitlement,
  `com.apple.developer.devicecheck.appattest-environment: "development"`
  (confirmed real Apple entitlement key/values via search, not guessed).
  **Needs to switch to `"production"` before an App Store release build** —
  app.json is static, so this has to be a manual edit at that point (or a
  small env-driven `app.config.js` if that becomes annoying).

### SDK upgrade: Expo 54 → 57 (forced, not optional)

Installing the real dev-client build surfaced `java.lang.NoClassDefFoundError:
Lexpo/modules/kotlin/types/AnyTypeCache` at app startup, inside
`IntegrityModule.kt`. Root cause: `@expo/app-integrity` has **never published
a version compatible with Expo SDK 54** — confirmed via `npm view
@expo/app-integrity versions`, whose earliest release is `56.0.0`, and whose
own `package.json` lists `devDependencies.expo: 57.0.6`. Its `peerDependencies.expo`
is just `"*"` so `npx expo install` didn't warn about this. There was no
config fix available — the app had to move to a newer SDK.

Given the user chose to upgrade rather than switch to non-Expo community
attestation libraries or pause the feature:
- `npx expo install expo@^57.0.0` then `npx expo install --fix` — bumped
  `expo` and every `expo-*`/React/React Native package to their SDK-57-
  compatible versions (react-native 0.81.5 → 0.86.2, react 19.1 → 19.2.3,
  reanimated/worklets/gesture-handler/screens/safe-area-context/svg/webview
  all bumped too). `react-native-bluetooth-classic` and
  `react-native-tcp-socket` are **not** Expo-bundled modules so weren't
  touched by this — their `peerDependencies.react-native` ranges (`>=0.73.1`
  and `>=0.60.0`) are satisfied by 0.86.2, but that's only a declared-range
  check, not a runtime guarantee; they still need real-device verification
  (printing flow specifically) alongside the auth flow.
- `expo-modules-core` (transitive) is now `57.0.10`, confirmed to actually
  contain `AnyTypeCache.kt` at the exact path the crash referenced — strong
  evidence, though not 100% proof short of a real rebuild, that this is fixed.
- `expo install --fix` auto-added `expo-font`/`expo-image`/`expo-secure-store`/
  `expo-status-bar` to `app.json`'s `plugins` array (SDK 57 requires explicit
  plugin registration these didn't need before) — left as-is, this is
  expected/correct behavior, not something to revert.
- `expo-doctor` flagged one issue post-upgrade: the top-level `app.json`
  `splash` key is no longer a valid schema field on SDK 57 (splash config
  now lives entirely in the `expo-splash-screen` plugin entry, which already
  had the same image/color/resizeMode settings) — removed the now-redundant
  top-level key. `expo-doctor` is clean (20/20) after that.
- **Found and fixed a real, unrelated regression this upgrade would have
  introduced silently**: `react-native-view-shot` got bumped 4.0.3 → 5.1.0
  (a major version) as part of the RN/reanimated dependency chain, and v5
  **removed the `pixelRatio` capture option entirely** (confirmed by reading
  the installed package's source directly — `grep` found zero references,
  despite the v5.0.0 GitHub release notes claiming "the public API is
  unchanged," which is simply wrong on this point). `components/print/
  ReceiptCaptureHost.jsx` used `pixelRatio: 2` to deliberately oversample
  receipt captures for print quality; that option would now silently do
  nothing (unknown options pass through `validateOptions` uncomplained).
  Fixed by computing explicit `width`/`height` from each view's actual
  `onLayout` height × 2, which is what v5 expects instead. This has nothing
  to do with auth — it's a drive-by fix made necessary by the SDK bump this
  auth feature forced, and is worth spot-checking on a real print job.
- **Second forced fix, found on the first real bundling attempt**: as of SDK
  56, `expo-router` vendors its own fork of `@react-navigation/*` and no
  longer permits importing those packages directly — Metro fails the bundle
  with "expo-router is no longer compatible with react-navigation" (not just
  a warning; a hard bundling error). Fixed every direct
  `@react-navigation/*` import across the app (confirmed zero remain via
  `grep`) by switching to the equivalent `expo-router` export, verified
  against the actual installed package source (not just the migration docs,
  which turned out to be incomplete for `BottomTabBar` specifically):
  `useFocusEffect`/`DarkTheme`/`DefaultTheme`/`ThemeProvider` now come
  straight from `"expo-router"` (its exports re-export them, and the
  `expo-router/react-navigation` path that also has them is marked
  `@deprecated` in favor of this), and `BottomTabBar` comes from
  `"expo-router/js-tabs"` (re-exported through a chain of wildcard exports
  that isn't obvious from the docs alone). Touched: `app/_layout.jsx`,
  `app/(tabs)/_layout.jsx`, `app/(tabs)/{history,profile,favorites,
  transactions}.jsx`, `app/profile/devices.jsx`.
- Every app source file (78 files under `app/`, `components/`, `services/`,
  `hooks/`, `state/`, `constants/`, `utils/`, `plugins/`) was parse-checked
  against the new `babel-preset-expo` — all clean. `expo-doctor` is 20/20.
  **Beyond that**: `npx expo export --platform android` (a full Metro
  production bundle, the exact step that was failing) now completes clean —
  "Android Bundled ... (2026 modules)" with real output artifacts, no
  errors. This is the strongest verification possible short of an actual
  device install, which still hasn't happened post-upgrade.

What's still needed before this is real (infra, not code):
- [x] **Google Cloud**: project with Play Integrity API enabled, linked to
      the app's Play Console listing; `EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER`
      (mobile) and `GOOGLE_PLAY_INTEGRITY_PACKAGE_NAME` +
      `GOOGLE_PLAY_INTEGRITY_CREDENTIALS` (server) are set. A **dedicated**
      service account (`play-integrity-verifier@...`, role
      `roles/serviceusage.serviceUsageConsumer`) was created rather than
      reusing the project's existing Firebase Admin SDK service account.
      Confirmed the service account can authenticate (minted a real access
      token in a throwaway test script). **Not yet confirmed**: an actual
      device successfully getting a `MEETS_DEVICE_INTEGRITY` verdict — the
      SDK-54-vs-57 crash blocked that test before it got that far.
- [ ] **Apple Developer Program** enrollment, an App ID with the App Attest
      capability registered, Team ID for `APPLE_APP_ATTEST_TEAM_ID` on the
      server. In Xcode: Signing & Capabilities → **+ Capability** → **App
      Attest** (this is normally a one-click Xcode step; for an EAS-managed
      project without a checked-in `ios/` folder, confirm during the next
      `eas build` / `expo prebuild` that the `app.json` entitlement above is
      sufficient or whether a small local config plugin — same pattern as
      the existing `./plugins/withBluetoothManifestAttributes.js` — is
      needed to inject it reliably).
- [ ] EAS dev-client rebuild on the now-SDK-57 project
      (`npm run build:dev:android` / `npm run build:dev:ios`) — the crash
      that started this SDK-upgrade detour happened on a **pre-upgrade**
      dev-client build; a fresh build against the current `package.json` is
      needed before the next real-device test.
- [x] Server-side Android: real Google verification implemented in
      `playIntegrity.js` (see §6) — not yet exercised end-to-end against a
      real device token (blocked on the dev-client rebuild above).
- [ ] Server-side iOS: real Apple verification in `appAttest.js` (Phase 5) —
      including the `AttestedKey` persistence layer described in §6. Still a
      stub.

Until the rebuilt dev-client is tested end-to-end, **login only reliably
works with `SANDBOX_MODE=true` on the server and `EXPO_PUBLIC_SANDBOX_MODE=true`
on the mobile app** — this is expected, not a bug, and matches how the rest
of this codebase's sandbox mode already works.

## 8. Admin panel changes (`mdcard-panel/`, this repo)

Panel already talks directly to the same MongoDB and duplicates models
(`server/models/cardCategory.model.js` exists in both repos independently) —
follow that pattern rather than proxying through the main API.

- Mirror `session.model.js` and `apiKey.model.js` into
  `mdcard-panel/server/models/`.
- New admin routes/controllers for:
  - Listing/revoking a given user's active sessions (surfaced on the existing
    user detail view).
  - Issuing a new named API key for a business user (raw key shown once),
    listing existing keys (prefix + last-used only, never the raw value again),
    revoking a key.
- Admin's own login (`admin.model.js`, cookie+JWT) is unrelated to this
  refactor — admins aren't phones, Play Integrity/App Attest doesn't apply to
  them. Leave admin auth as-is unless told otherwise.

## 9. Security notes

- Never store raw session tokens or API keys — hash (SHA-256 is fine for
  high-entropy random tokens; this isn't a low-entropy password) and look up
  by hash, same principle already used for card codes (`cardCodeCrypto.js`)
  and passwords (bcrypt).
- Rate-limit API-key traffic per key (not just per-IP) since a single business
  integration can legitimately burst in ways a single phone shouldn't.
- LRU eviction on cap overflow should be logged/notify-able (push notification
  or next-login banner: "you were signed out on `<device>` because you signed
  in on a new device") so it doesn't look like an unexplained logout.
- Attestation verification failures should fail closed (`403
  AUTH_DEVICE_ATTESTATION_FAILED`) — never fall back to issuing a session
  without a verified attestation.

## 10. Phased checklist

### Phase 1 — Server: session infrastructure (`mdcard/server`) ✅ code landed
- [x] `session.model.js`, `server/config/authLimits.js`
- [x] `server/utils/session.js` (token gen/hash, cap+eviction)
- [x] `server/services/playIntegrity.js` — **real implementation**, not a
      stub anymore (calls Google's `decodeIntegrityToken`, see §6).
      `server/services/appAttest.js` still a stub: sandbox mode fakes a
      passing verdict; outside sandbox it fails closed with
      `APP_ATTEST_NOT_CONFIGURED`/`APP_ATTEST_NOT_IMPLEMENTED` until Apple
      credentials + the real verification call are wired (Phase 5).
- [x] Rewrite `auth.middleware.js` (kept the existing `verifyToken`/
      `getUserInfo` export names rather than renaming to `requireAuth` — same
      dual session-or-API-key behavior, just less churn across the 11 route
      files that already import them; added `requireSession` as planned)
- [x] `POST /device-challenge` (see path note below)
- [x] Update `login`, `verifyAccount`, `resetPassword` in `auth.controller.js`
      to issue sessions instead of JWT access tokens (via
      `server/services/deviceAuth.js`, a new orchestration layer these three
      call sites share)
- [x] `POST /logout` (session-only), `POST /logout-all` (any auth method —
      lets an API key holder kill every phone session on the account),
      `GET /sessions`, `DELETE /sessions/:id`
- [x] Wired: `user.route.js` push-token endpoints now also require
      `requireSession` (an API key has no device to push-notify); every other
      route keeps working unchanged since `verifyToken`/`getUserInfo` kept
      their names.
- [x] Real Play Integrity verification landed (see above). **Not done**: real
      App Attest verification (iOS), so non-sandbox login only works for
      Android right now, and even that hasn't been confirmed end-to-end
      against a real device yet (see §7's SDK-upgrade section).

### Phase 2 — Server: API keys (`mdcard/server`) — partially landed
- [x] `apiKey.model.js`
- [x] Key generation/hashing utils (`server/utils/apiKey.js`), business-role
      eligibility re-checked on every request (not just at issuance)
- [ ] Admin-facing CRUD endpoints (issue/list/revoke) — deliberately deferred
      to Phase 4 (this repo), built directly against the shared DB (matches
      how this repo already owns `Admin`-authenticated writes). **Done** —
      see Phase 4 below, this line is kept for history.
- [ ] Per-key rate limiting

### Phase 3 — Mobile app (`mdcard-mobile/`, other repo) — code landed, SDK upgraded, blocked on a fresh device test
- [x] `services/deviceAttestation.js` using the official `@expo/app-integrity`
      module (no custom native module needed — see §7)
- [x] `authApi.js` / `api.js` updates (device-challenge fetch + attestation on
      login/verify/reset-password, global session-expiry handling, logout/logoutAll)
- [x] "Manage devices" screen (`app/profile/devices.jsx`), linked from the
      profile tab for every user, wired into `_layout.jsx`
- [x] iOS App Attest entitlement added to `app.json`
- [x] User-facing error messaging for the new device-attestation error codes
- [x] **Expo SDK upgraded 54 → 57** (forced — `@expo/app-integrity` has no
      SDK-54-compatible release; see §7). Confirmed via `expo-doctor` (20/20)
      and a full parse-check of every app source file. Found and fixed one
      real, unrelated regression this pulled in:
      `react-native-view-shot` v5 dropped the `pixelRatio` capture option
      that `ReceiptCaptureHost.jsx` relied on for print quality — replaced
      with explicit `width`/`height` from measured layout, v5's supported
      mechanism.
- [x] Real Android (Play Integrity) server verification implemented — see
      Phase 1. Found and fixed a request-hash comparison bug in the same pass
      (see §6).
- [ ] **Not confirmed yet**: an actual device successfully completing login
      end-to-end. The dev-client build that first surfaced the SDK
      incompatibility predates the SDK-57 upgrade, so a fresh
      `npm run build:dev:android` + real-device test is the next step. Also
      still needed: Apple Developer setup + real App Attest verification
      (iOS) — see the checklist in §7. Login currently only reliably works
      with both sandbox flags on.
- [ ] LRU-eviction UX ("you were signed out because you logged in on another
      device") — not built; the eviction itself works server-side, but the
      evicted device just sees a normal session-expired prompt on its next
      request rather than a specific explanation.

### Phase 4 — Admin panel (`mdcard-panel/`, this repo) — backend + UI landed
- [x] Mirror `Session`/`ApiKey` models (`server/models/`)
- [x] Backend routes, mounted under the existing `/api/user` router (already
      behind this repo's own admin `verifyToken`):
      `GET/DELETE /api/user/sessions?userId=|id=`,
      `GET/POST/DELETE /api/user/api-keys?userId=|id=` (`POST` body
      `{ userId, name }`, returns the raw secret exactly once — see
      `controllers/apiKey.controller.js`). Enforces `API_KEY_SOFT_CAP` (5)
      and business-only eligibility at issuance time.
- [x] Per-user session list + revoke UI
      (`client/src/pages/users/user/components/SessionsSection.jsx`) — new
      section on the user detail page, listing `platform`/`deviceName`/
      `appVersion`/`createdAt`/`lastUsedAt` with a revoke button per row.
      Renders for every user regardless of role.
- [x] Business API key issuance/revocation UI
      (`client/src/pages/users/user/components/ApiKeysSection.jsx`) — name
      input + create button whose dialog shows the returned secret exactly
      once with a copy button and a "won't be shown again" warning; the list
      after that shows only prefix/name/status/last-used, plus a revoke
      button. Only rendered on the user page when `role === "business"`.
      Wired into `pages/users/user/index.jsx`. `npm run build` passes
      cleanly with these changes.

### Phase 5 — Cleanup
- [x] Real Google Play Integrity verification in `playIntegrity.js` (decrypt
      token, compare echoed requestHash to the challenge, check verdicts) —
      done ahead of schedule, during Phase 3, once real device testing made
      it necessary. Not yet confirmed against a real device (see Phase 3).
- [ ] Real Apple App Attest verification in `appAttest.js`, **including a new
      `AttestedKey`-style collection** to persist a device's public key
      across logins (attestation only happens once per device install; every
      login after that only sends an assertion, which needs something to
      verify it against — see §6)
- [ ] Remove JWT-access-token references now that sessions/keys are the only
      access-token mechanism (there's nothing left mid-migration to clean up
      here — Phase 1 replaced JWT access tokens outright rather than running
      both in parallel, per the "not a concern right now" rollout decision)
- [ ] Update `mdcard/server/docs/openapi.js` / API guide for the new auth
      methods (respect existing docs-scope conventions for `server/docs`) —
      this is also where the `/login` business-partner guidance gets
      replaced with API-key instructions, closing the gap in the "Before
      this can ship" note
- [x] Update `mdcard/CLAUDE.md`'s auth section to describe sessions/API keys
      instead of JWT — done in the same session as Phase 1

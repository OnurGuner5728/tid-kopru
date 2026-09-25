# TİD Köprü PWA Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing static PWA reliable to install and use on Android Chrome, including text, device speech, cached avatar use, clear failures, and a documented release package.

**Architecture:** Keep the current no-server HTML, CSS, and ES module app. Harden the existing classic service worker with a separately testable cache policy, keep the app shell available if large avatar downloads fail, and show understandable status/retry actions in the interface.

**Tech Stack:** Browser ES modules, Service Worker Cache API, Three.js already vendored in `public/vendor/three`, Node.js built-in `node:test`, Python's built-in static HTTP server for local smoke checks.

**Spec:** `docs/superpowers/specs/2026-09-25-tid-kopru-design.md` (sections A, E, Verification, Scope)

## Global Constraints

- Free, no account, no application server, no paid API.
- Main distribution target is an HTTPS static PWA installed in Android Chrome.
- Text and avatar run on-device; browser speech recognition may use a remote service and must say so.
- The avatar dictionary is exact word matching and is not natural TİD sentence translation.
- Public distribution is blocked until the `rain.glb` asset license is verified or the file is replaced by a compatible asset with documented redistribution rights.
- Do not include participant media, ASR model binaries, or other generated large data in Git.

## Review Focus

- Offline navigation after an incomplete first download must show the cached app shell or a clear offline error.
- Failed avatar/model downloads must not prevent text and reply tools from starting; retry must remain available.
- A denied or unavailable microphone must leave manual text entry usable and report the reason.
- A stale cached release must update without deleting unrelated browser caches.
- Any asset with unresolved redistribution rights must prevent public release; local prototype use is not evidence of distribution permission.

---

### Task 1: Make cache fallback policy independently testable

**Files:**
- Create: `public/sw-policy.js`
- Create: `tests/sw-policy.test.mjs`
- Modify: `package.json` only if the existing test script does not discover the new test (it currently uses `node --test tests/*.test.mjs`).

**Interfaces:**
- Produces: `getOfflineAwareResponse({ request, cache, fetcher, origin, shellUrl })` returns a cached response, a successful network response, an offline app-shell response for navigations, or a 503 response when no offline response exists; `shouldDeleteCache(name, currentName)` is true only for older `tid-kopru-v<number>` caches.

- [ ] **Step 1: Write the failing cache-policy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const request = (url, mode = 'cors') => ({ method: 'GET', url, mode });
const source = await readFile(new URL('../public/sw-policy.js', import.meta.url), 'utf8');
const context = { URL, Response };
context.globalThis = context;
vm.runInNewContext(source, context);
const { getOfflineAwareResponse, shouldDeleteCache } = context.TidKopruCachePolicy;

test('offline navigation returns the cached app shell', async () => {
  const shell = new Response('<main>TİD Köprü</main>');
  const cache = { match: async (key) => key === 'https://tid.test/index.html' ? shell : undefined,
    put: async () => {} };
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/conversation', 'navigate'), cache,
    fetcher: async () => { throw new Error('offline'); },
    origin: 'https://tid.test', shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(await result.text(), '<main>TİD Köprü</main>');
});

test('successful same-origin GET responses are cached', async () => {
  let stored;
  const cache = { match: async () => undefined, put: async (_key, value) => { stored = value; } };
  const network = new Response('ok');
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/styles.css'), cache,
    fetcher: async () => network, origin: 'https://tid.test',
    shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(await result.text(), 'ok');
  assert.ok(stored);
});

test('cache quota failure does not replace a successful network response', async () => {
  const cache = { match: async () => undefined, put: async () => { throw new Error('quota'); } };
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/styles.css'), cache,
    fetcher: async () => new Response('network result'), origin: 'https://tid.test',
    shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'network result');
});

test('non-GET requests are left to the browser', async () => {
  const result = await getOfflineAwareResponse({
    request: { method: 'POST', url: 'https://tid.test/', mode: 'cors' },
    cache: { match: async () => undefined, put: async () => {} },
    fetcher: async () => new Response('unused'), origin: 'https://tid.test',
    shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(result, null);
});

test('offline asset miss returns a visible service-unavailable response', async () => {
  const result = await getOfflineAwareResponse({
    request: request('https://tid.test/assets/avatar/rain.glb'),
    cache: { match: async () => undefined, put: async () => {} },
    fetcher: async () => { throw new Error('offline'); },
    origin: 'https://tid.test', shellUrl: 'https://tid.test/index.html'
  });
  assert.equal(result.status, 503);
  assert.match(await result.text(), /Çevrimdışı/u);
});

test('only old app caches are deleted during activation', () => {
  assert.equal(shouldDeleteCache('tid-kopru-v1', 'tid-kopru-v2'), true);
  assert.equal(shouldDeleteCache('tid-kopru-v2', 'tid-kopru-v2'), false);
  assert.equal(shouldDeleteCache('unrelated-site-cache', 'tid-kopru-v2'), false);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail because the policy module is not implemented**

Run: `node --test tests/sw-policy.test.mjs`  
Expected: FAIL because `public/sw-policy.js` does not yet define `TidKopruCachePolicy`.

- [ ] **Step 3: Implement the response policy**

Implement this signature in `public/sw-policy.js`; use `cache.match(request.url)`, cache only successful same-origin GET responses with `response.clone()`, use `shellUrl` only for failed `navigate` requests, and return `new Response('Çevrimdışı. Bu içerik henüz indirilmedi.', { status: 503 })` when no cached response exists. Attach `getOfflineAwareResponse` to `globalThis.TidKopruCachePolicy` so the same classic script can be loaded by the worker with `importScripts()` and by Node's `vm` in tests.

```js
((scope) => {
  async function getOfflineAwareResponse({ request, cache, fetcher, origin, shellUrl }) {
    if (request.method !== 'GET') return null;
    const cached = await cache.match(request.url);
    if (cached) return cached;
    let response;
    try {
      response = await fetcher(request);
    } catch {
      if (request.mode === 'navigate') {
        const shell = await cache.match(shellUrl);
        if (shell) return shell;
      }
      return new Response('Çevrimdışı. Bu içerik henüz indirilmedi.', { status: 503 });
    }
    if (response.ok && new URL(request.url).origin === origin) {
      try { await cache.put(request.url, response.clone()); } catch { /* Keep the successful network response on storage pressure. */ }
    }
    return response;
  }
  function shouldDeleteCache(name, currentName) {
  return /^tid-kopru-v\d+$/.test(name) && name !== currentName;
  }
  scope.TidKopruCachePolicy = { getOfflineAwareResponse, shouldDeleteCache };
})(globalThis);
```

- [ ] **Step 4: Run the focused tests and the existing suite**

Run: `node --test tests/sw-policy.test.mjs`  
Expected: PASS, 6 tests.  
Run: `npm test`  
Expected: PASS, including the existing Turkish matcher tests.

- [ ] **Step 5: Commit the cache policy and tests**

```powershell
git add public/sw-policy.js tests/sw-policy.test.mjs
git commit -m "test: cover offline response policy"
```

### Task 2: Split app-shell caching from large avatar assets

**Files:**
- Modify: `public/service-worker.js`
- Modify: `public/app.mjs`
- Modify: `tests/sw-policy.test.mjs`

**Interfaces:**
- Consumes: `self.TidKopruCachePolicy.getOfflineAwareResponse` from Task 1.
- Produces: versioned app-shell installation; same-origin runtime caching for avatar assets after first successful fetch; offline navigation fallback; activation that deletes only cache names beginning `tid-kopru-` and not the current version.

- [ ] **Step 1: Extend tests for cache scope and shell-vs-avatar behavior**

Add tests that parse `APP_SHELL_ASSETS` from `public/service-worker.js` and assert (a) `./assets/avatar/rain.glb` and `./assets/avatar/saved-poses.json` are not in the install shell list, (b) `./`, `./index.html`, `./styles.css`, `./app.mjs`, `./avatar.mjs`, `./matcher.mjs`, `./sw-policy.js`, `./manifest.webmanifest`, both icons, and all three vendored Three.js modules are in the shell list, and (c) `shouldDeleteCache(name, current)` retains `unrelated-site-cache` while deleting `tid-kopru-v1` when activating `tid-kopru-v2`.

- [ ] **Step 2: Run the focused tests and verify the new shell assertions fail**

Run: `node --test tests/sw-policy.test.mjs`  
Expected: FAIL on the old single `APP_ASSETS` list and missing cache-scope policy.

- [ ] **Step 3: Implement a versioned classic-worker integration**

Keep `public/service-worker.js` as the registered script URL and call `importScripts('./sw-policy.js')` before registering handlers. Do not change the registered URL or worker type. Use `tid-kopru-v2` and this exact shell list: `./`, `./index.html`, `./styles.css`, `./app.mjs`, `./avatar.mjs`, `./matcher.mjs`, `./sw-policy.js`, `./manifest.webmanifest`, `./icons/icon.svg`, `./icons/maskable.svg`, `./vendor/three/three.module.js`, `./vendor/three/addons/loaders/GLTFLoader.js`, and `./vendor/three/addons/controls/OrbitControls.js`. Keep avatar/model data out of the install shell; cache them at runtime after successful same-origin fetch. On activation, delete only older `tid-kopru-v<number>` caches and claim clients.

- [ ] **Step 4: Connect service-worker registration failures to a visible status**

In `public/index.html`, add a `role="status"` element with id `pwa-status`. In `public/app.mjs`, handle both resolve and reject of `navigator.serviceWorker.register('./service-worker.js')`; report that installation is available on HTTPS and that first-time offline use requires opening the avatar once. Never disable text entry when registration fails.

- [ ] **Step 5: Run syntax, policy, and matcher checks**

Run: `npm run check`  
Expected: PASS for all application modules.  
Run: `npm test`  
Expected: PASS for policy and matcher tests.

- [ ] **Step 6: Commit the service-worker update**

```powershell
git add public/service-worker.js public/sw-policy.js public/app.mjs public/index.html tests/sw-policy.test.mjs
git commit -m "feat: make PWA cache upgrades and offline launch reliable"
```

### Task 3: Make loading, permission, and failure states usable

**Files:**
- Modify: `public/app.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `tests/matcher.test.mjs` only if a behavior in `matcher.mjs` changes.

**Interfaces:**
- Consumes: existing `SignAvatar.initialize()` progress callback and speech event handlers.
- Produces: actionable live status for avatar download/failure/retry, service worker registration, browser speech support, microphone denial, and offline state.

- [ ] **Step 1: Add the user-visible status elements and retry control**

Add `#avatar-retry` next to the existing avatar loader and `#pwa-status` in the app shell. Both status strings use `aria-live="polite"`; retry has a clear Turkish accessible label and remains visible after a failed avatar load.

- [ ] **Step 2: Wire retry and speech error behavior**

Refactor avatar initialization into `loadAvatar()` so both first load and retry use the same path. Reset loader visibility before retry; disable retry while loading; restore it on failure. Map `not-allowed`, `service-not-allowed`, `no-speech`, `network`, and unsupported API states to concise Turkish messages. Manual text entry and the TTS reply flow remain available in every state.

- [ ] **Step 3: Add styles for visible focus and reduced-motion-compatible loading**

Add `:focus-visible` outlines for buttons, inputs, and links; ensure the retry button meets the existing 48px touch target; preserve the existing `prefers-reduced-motion` rule and apply it to any new loading animation.

- [ ] **Step 4: Run source checks and use the manual screen-reader/keyboard checks in Task 5**

Run: `npm run check` and `npm test`.  
Expected: PASS; no package install is needed.

- [ ] **Step 5: Commit status and retry behavior**

```powershell
git add public/app.mjs public/index.html public/styles.css
git commit -m "feat: explain PWA and speech failures and allow retry"
```

### Task 4: Document use, privacy, known limits, and release gate

**Files:**
- Create: `README.md`
- Create: `docs/manual-android-checklist.md`
- Modify: `ASSET-NOTICE.txt` only when additional attribution or a replacement asset is verified.

- [ ] **Step 1: Write the Turkish setup and install guide**

Document the command `python -m http.server 8000 --directory public`, the `http://localhost:8000` local test URL, HTTPS as a prerequisite for remote Android install and camera/microphone permissions, first avatar download size, current browser speech data caveat, supported scope, and the “not full sentence translation / not emergency tool” limits.

- [ ] **Step 2: Write a release checklist with explicit license hold**

Include checks for every item in `public/`, the license notice for vendored Three.js, confirmation or replacement for `rain.glb`, PWA manifest icons, service-worker scope, and user-facing privacy text. If the model right cannot be confirmed, locate a redistributable rigged model whose skeleton contains the pose names used by `saved-poses.json`, replace the file, and verify the saved poses animate it. If no compatible licensed model is available, keep public deployment blocked and hand the owner the rights decision.

- [ ] **Step 3: Inspect the complete documentation against the design**

Check that no sentence claims natural TİD translation, full offline speech, zero network use, or broad device coverage before those behaviors are measured.

- [ ] **Step 4: Commit the guides**

```powershell
git add README.md docs/manual-android-checklist.md ASSET-NOTICE.txt
git commit -m "docs: explain setup privacy and release checks"
```

### Task 5: Verify the PWA on a physical Android phone

**Files:**
- Modify: `docs/manual-android-checklist.md` with actual results only.

- [ ] **Step 1: Serve the public directory on HTTPS**

Use the owner's static hosting account only after asset rights are clear. Until then, do not publish the avatar or open a public HTTPS preview; mark the phone-install check blocked. Do not add analytics or a backend.

- [ ] **Step 2: Install and exercise the checklist**

On Android Chrome, install the PWA; load the avatar once; enable airplane mode; reopen; exercise keyboard-only navigation and a screen reader, text entry, full-screen text, quick reply, device speech where present, avatar playback, missing words, retry, microphone-denied, and unsupported speech behavior.

- [ ] **Step 3: Record browser/device/version and each observed result**

Record only technical results in the checklist; do not collect bystander speech or media. Any failed item returns to the owning task above and must pass on a rerun.

- [ ] **Step 4: Commit the completed manual checklist**

```powershell
git add docs/manual-android-checklist.md
git commit -m "docs: record Android PWA release verification"
```

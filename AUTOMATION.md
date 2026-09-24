# Live search, browser and Android automation

All three integrations are in the root lightweight app. Original upstream code remains separate. **No paid search/automation API is required**, but you need the software/services below and suitable hardware. AI chat/planning still depends on Kilo free-model availability.

## Quick feature guide

Open **Action center** below the chat:

1. **Search the web**: returns up to five source links and snippets without invoking an AI model.
2. **Live search with replies** checkbox: searches the latest question and supplies sources to the chat model. The checkbox is opt-in because it shares your query with SearXNG/search engines and snippets with the AI. The model is asked to cite `[1]`, `[2]`, etc.; source links are shown below its answer.
3. **Review browser action** / **Review phone action**: prepares the exact action JSON; nothing runs yet. Check it, then click **Confirm this action**.
4. **Propose action**: sends a natural-language task to the free AI model and proposes one validated action. It still requires confirmation. It cannot see the current page or phone screen, does not invent missing coordinates/selectors, and may ask for more detail. Use the manual controls if the model returns invalid JSON or the gateway is unavailable.

Every automation action, including read-only device listing/screenshots, requires a confirmation. Confirmations expire after 120 seconds, can be cancelled, and cannot be replayed. Executing one invalidates other pending proposals. Browser click/fill/read proposals are also bound to the page URL at preparation time. A page can change in place or a phone screen can change; **always inspect the current target before approving**.

## 1. Live search (SearXNG)

### Existing trusted remote instance

Add to `.env` and restart:

```dotenv
SEARXNG_URL=https://your-searxng.example
SEARCH_LOCAL=0
PRIVACY_MODE=tor
TOR_PROXY=socks5h://127.0.0.1:9050
```

Use the base URL, **not** `/search`. SearXNG must enable `search.formats: [html, json]`. Some public instances disable JSON or reject Tor; this app does not switch to an unapproved provider when that happens. Remote HTTPS requests go through the configured Tor proxy, including DNS. `PRIVACY_MODE=direct` is an explicit opt-out for search/chat, not for browser automation.

### Self-hosted optional Compose profile

Set these values in `.env` (alongside the access token):

```dotenv
ACCESS_TOKEN=replace-with-a-long-random-token
SEARXNG_SECRET=replace-with-a-separate-long-random-secret
SEARXNG_URL=http://searxng:8080
SEARCH_LOCAL=1
```

Generate secrets yourself, e.g. `openssl rand -hex 32`. Do not commit `.env`.

```sh
docker compose --profile search up --build -d
```

The SearXNG service is not exposed publicly. App → SearXNG uses the private Docker network; SearXNG → search engines uses `socks5h://tor:9050` from `deploy/searxng/settings.yml`. Both app and SearXNG have only the internal network; only Tor has external egress. Engines may reject Tor exits or time out. No bypass/circuit rotation is implemented.

For a **native Node** app with a separate local SearXNG installation, use `SEARXNG_URL=http://127.0.0.1:8080` and `SEARCH_LOCAL=1`; configure that SearXNG service's own Tor egress. `SEARCH_LOCAL` accepts only loopback or the `searxng` service hostname. The Compose setup does not publish port 8080 for a native app.

Results are links/snippets, not a full arbitrary-URL scraping service. Opening a result in your normal browser uses that browser's network, **not** server Tor.

## 2. Browser automation (Playwright)

Use the native Node app on a Linux/macOS/Windows host supported by Playwright. This is a separate, temporary **server-side Chromium** session, not the user's existing browser tabs. The default Docker image is a small Alpine chat/search image and intentionally does not include Chromium or its OS dependencies.

```sh
npm ci
npm run browser:install
# On supported Linux systems, install OS libraries if needed:
npx playwright-core install-deps chromium
```

Set `.env`:

```dotenv
ACCESS_TOKEN=your-long-random-token
ENABLE_BROWSER=1
BROWSER_ALLOWED_HOSTS=example.com,www.example.com
PRIVACY_MODE=tor
TOR_PROXY=socks5h://127.0.0.1:9050
```

Start Tor and restart JARVIS. Enter the server access token in the UI.

- **Open page** accepts HTTPS URLs on exact allowlisted hosts. Redirects, scripts and network subresources are checked too. Add necessary trusted asset/redirect hosts explicitly; wildcards are not supported.
- **Read page** returns URL, title, text and up to 60 controls with suggested CSS selectors. Page text/screenshots are not automatically submitted to AI.
- **Click element** requires a selector matching exactly one element, e.g. `button#search`.
- **Fill field** replaces the text in exactly one matching input/textarea, e.g. `input[name="q"]`. It does not automatically submit the form.
- **Close browser** discards the session and frees memory. The browser also closes after 2 minutes idle.

Chromium starts only after a confirmed open action. It refuses to start below 512 MB *available server* RAM. This is a guard, not proof of sufficient RAM for every site. **1 GB whole-system browser automation is not guaranteed**; keep chat/search/phone on the smaller machine or run the server on a larger host. Chromium sandboxing is required; no `--no-sandbox` fallback is used. If your container/kernel disallows the sandbox, use a supported host rather than removing the protection.

Browser automation is **Tor-only in this version**. Chromium uses the SOCKS proxy with local hostname resolution disabled for destination hosts. No direct fallback, WebSocket traffic, downloads, popups, camera/microphone permissions or service workers are enabled. Images/media/fonts are blocked to reduce resource use. Some sites will not function under these restrictions. This is not an anti-fingerprinting Tor Browser replacement. Keep the hostname allowlist limited to sites you trust and use network isolation for stronger containment.

## 3. Android phone control (ADB)

This works with **Android only**. Run the JARVIS backend on the computer connected to your phone. GitHub, a cloud preview, or a remote server cannot access your USB phone by itself. iPhone/iOS automation is not included.

1. Install official Android SDK Platform-Tools (`adb`) on that computer.
2. Enable Android Developer options → USB debugging.
3. Connect your own phone via USB and approve the computer's debugging prompt on the phone.
4. Set `ACCESS_TOKEN` and `ENABLE_PHONE=1` in `.env`, restart, enter the token in the UI.
5. Choose **List devices** → review → confirm. Copy the authorized serial from the result.
6. Set `ADB_ALLOWED_SERIALS=that-serial` in `.env` and restart. Multiple authorized serials may be comma-separated.

```dotenv
ACCESS_TOKEN=your-long-random-token
ENABLE_PHONE=1
ADB_PATH=adb
ADB_ALLOWED_SERIALS=your-device-serial
```

Use **Screenshot** to inspect the screen, then specify exact pixel coordinates for **Tap** or **Swipe**. Swipes last 400 ms from the UI. **Back/Home** use only those fixed keycodes. **Type text** supports English letters, digits, spaces and `. , _ @ -`; other characters are rejected to prevent shell injection through ADB's shell argument handling. Use the phone keyboard for Telugu/other Unicode text in this initial implementation.

No arbitrary ADB shell, install/uninstall, file pull/push, connect/pair commands or wireless discovery endpoints are exposed. Configure/authorize the device yourself; never expose ADB's port to the public internet. Device selection is explicit even if only one phone is connected. USB input control can fail on vendor-specific devices that require an additional debugging/input security setting; the server reports command failure rather than claiming success.

Screenshots are returned to the tab as PNG and are not saved by this app or sent to the AI. ADB traffic is local/device traffic, **not Tor traffic**. Apps on the phone retain their own network routes; tapping a browser or app on the phone does not anonymize it. Some protected screens cannot be captured.

## Safety / limitations

- No always-on autonomous agent: only user-approved single actions.
- A click/tap can still make a purchase, send a message or delete data. Confirmation is not a guarantee that an action is harmless.
- Do not fill passwords or payment details via the AI planner; free model providers may log prompts.
- A single shared access token is intended for one trusted operator, not a multi-user public service. Use HTTPS/firewall protection and keep it private.
- Tool results are treated as text, not executable HTML. The planner cannot inject arbitrary shell/evaluate code into the supported action schema.
- Internet providers, search engines, Tor exits and free model quotas can fail. Failures are shown; there is no paid fallback or quota circumvention.

## API shape (same-origin / Bearer token)

- `GET /api/health` → configuration capabilities (not proof dependencies are installed).
- `POST /api/search` with `{ "query": "..." }` → results.
- `POST /api/chat` with `{ "messages": [...], "search": true }` → sourced reply.
- `POST /api/plan` with `{ "task": "Open https://example.com" }` → proposal, no execution.
- `POST /api/tools/prepare` with `{ "tool": "browser", "action": "open", "url": "https://example.com" }` → `{ confirmation, expires, action }`.
- `POST /api/tools/execute` with `{ "confirmation": "..." }` → executes the stored action once. Payload changes cannot alter the stored action.
- `POST /api/tools/cancel` with `{ "confirmation": "..." }` → cancels.

## Validation status

`npm test` runs 15 tests, including local HTTP search fixtures, fake ADB commands and mock Playwright behavior. `npm run check` passes syntax checks. These demonstrate request validation/control flow, **not live hardware/service success**.

In the implementation sandbox, Chromium download failed with TLS `ECONNRESET`, no Android phone/ADB was available, and no Docker runtime was present. Live SearXNG + Tor, real Chromium navigation, real phone control, and actual 1 GB operation need testing on your configured host.

SearXNG proxy configuration reference: https://docs.searxng.org/admin/settings/settings_outgoing.html

# Lucky · Free-only JARVIS

A low-overhead, text-first JARVIS with a Kilo cloud brain, live SearXNG search, confirmed Playwright/Android automation, explicit free-price checks, optional local device speech and fail-closed Tor routing. **No local model, Claude subscription, ElevenLabs subscription or GPU is needed for this lightweight mode.**

Original JARVIS source is preserved under [`upstream/jarvis`](upstream/jarvis), with its license and audio credits. The default root app is a new lightweight implementation, **not a full conversion of the original 3D/Claude agent**. Running the upstream app still uses its original paid services.

## What actually works / what is not claimed

| Capability | Default lightweight app |
|---|---|
| Cloud text conversation | Kilo OpenAI-compatible API; defaults to `kilo-auto/free` |
| Free-only policy | Live catalog pricing checked before every generation; missing/unknown/nonzero price blocks the request |
| Tor | Default `socks5h` route for gateway requests and DNS; no direct fallback |
| Low RAM adaptation | Server OS/cgroup memory selects bounded context and response sizes; one in-flight request; no React/WebGL/model downloads |
| Voice output | Browser local-service voices only; optional |
| Microphone | Optional browser recognition, explicit warning/consent; may bypass Tor through the browser vendor |
| Live search | SearXNG JSON results with links; standalone search or opt-in grounded chat |
| Browser automation | On-demand sandboxed Playwright Chromium; HTTPS host allowlist; Tor only; open/read/click/fill/close |
| Android control | ADB device list/screenshot/tap/swipe/type/Back/Home; explicit serial allowlist |
| Natural-language actions | AI proposes one validated action; user reviews and confirms; no autonomous execution |
| Images/video generation, arbitrary MCP tools, iPhone | **Not implemented** |
| Pollinations | **Not enabled**: live API/pricing could not be verified in the implementation environment. No unverified “unlimited free” fallback |
| Offline intelligence | Not included; cloud chat needs working internet and a available free provider |

“Free” means the app does not intentionally choose a paid model. Providers control quotas, terms, catalog accuracy and future pricing. A catalog check cannot prevent a provider changing billing between requests. Prefer anonymous access or an account with no funded balance and no auto-top-up. There is no quota bypass, account rotation or Tor circuit rotation.

See **[Search and automation setup](AUTOMATION.md)** for the Action center, required tools, authorization and privacy boundaries. Automation is disabled by default.

## Quick start (Node 22+)

```sh
npm ci
cp .env.example .env
# Edit .env: configure Tor; set a strong ACCESS_TOKEN before sharing the server.
npm start
```

Open `http://localhost:3000`. The app listens on `0.0.0.0` for preview/LAN compatibility; firewall it and configure `ACCESS_TOKEN` if it is reachable by others. Enter the token into the password field in the UI. Tokens are kept only in tab memory, not URLs or localStorage. Use HTTPS on remote deployments; the app does not supply TLS itself.

Install and start Tor separately, e.g. on Debian/Ubuntu:

```sh
sudo apt-get install tor
sudo systemctl enable --now tor
```

The default assumes Tor SOCKS on `127.0.0.1:9050`. Tor Browser is not automatically configured by this app. Allow Tor time to bootstrap. An unreachable proxy produces an error, not a direct request. `socks5h` performs gateway hostname resolution at the proxy. A SOCKS proxy is not proof it is really Tor: configure a trusted Tor service.

If you deliberately do not want Tor, set `PRIVACY_MODE=direct` in `.env` and restart. The UI reports the configured route (not a verified Tor circuit).

### Docker with isolated gateway egress

```sh
cp .env.example .env
# Set ACCESS_TOKEN to a long random value in .env
docker compose up --build -d
```

Open `http://localhost:3000`. The app is on an internal network, and only the Tor container also has external egress. The SOCKS port is not published to the host. The app and Tor each have a 192 MB memory limit; the optional SearXNG service has a 384 MB limit. Browser/OS/Docker overhead is additional. The default Alpine image intentionally does not include Chromium or ADB; run the Node app on a suitable host for automation. These are limits, not measured minimum requirements. Docker configuration has not been runtime-tested in this environment.

### No API key required by default

Kilo documents anonymous access for free models. Optional `KILO_API_KEY` stays server-side. Never paste API keys into chat, source files, Git or the browser bundle. The server only supports a fixed Kilo gateway URL, does not follow redirects and never falls back to a different provider/model. `KILO_MODEL` must exist in the live catalog with explicit zero prompt/completion pricing and all other reported pricing fields zero. If catalog format changes, the app intentionally blocks generation until reviewed.

## Hardware adaptation: 1 GB through 64 GB

- Below 2 GB total, or below 384 MB available: lite profile, 6 historical messages maximum, 4,000 context characters, 384 output tokens.
- Otherwise: 16 messages maximum, 12,000 context characters, 1,024 output tokens.
- Limits are recalculated per request. Linux cgroup memory constraints are respected.
- Browser low-motion mode is on by default. UI history is capped at 32 message bubbles. No camera, wake-word listener, 3D rendering or local model is loaded.
- Health metrics describe the **server**, not necessarily the client computer. Browser device-memory hints only affect visual mode.
- Browser automation refuses to launch with less than 512 MB available server RAM and closes after 2 minutes idle. Chromium uses additional memory; close it when finished. It is not automatically enabled on high-RAM systems.
- **An actual 1 GB whole-system test has not been performed.** A minimal Linux host is the intended target, not a promise that Chrome + a desktop OS will fit in 1 GB. High RAM does not auto-install a heavier local model. GPU presence is irrelevant to this text client.

## Privacy and safety

Tor can hide your source IP from the gateway; **it does not hide prompts, account identifiers, API keys, timing or model outputs from providers**. Kilo warns that auto-free routes may use providers that log data and use it to improve services. Do not send confidential data. Tor exit nodes may be blocked or rate-limited; the app reports an error rather than circumventing those restrictions.

Tor routing covers the AI gateway, remote SearXNG requests, and the separate automation browser. A local SearXNG service needs its own upstream proxy; the optional Compose profile configures it. Opening search result links in your normal browser does **not** inherit server-side Tor. ADB uses a local/authorized device connection, not Tor, and apps on the phone use their own network.

Microphone recognition is not a Tor-proxied backend feature. Browser vendors may process audio remotely; leave it off for a gateway-only privacy route. Voice output only selects voices marked `localService`; unavailable voices result in text-only output. No transcript is persisted by this app; the provider and browser may have their own retention.

This is a single-user assistant, not a hardened multi-tenant public service. It does not execute model-generated shell commands or HTML and exposes no general filesystem access. Automation requires an access token, explicit enable flags and expiring single-use confirmation IDs bound to normalized actions. **A confirmed click/tap can still send a message, delete data, or purchase something on the target screen.** Verify every action. There is no semantic guarantee that a selector or coordinate is harmless. Browser/phone text is not automatically sent to AI; only the separate planner task and configured hosts/serials are sent. Answers and tool text are rendered as text, not HTML. No automatic tool loop is used.

The automation browser is a fresh sandboxed session, not an attached personal Chrome profile. Downloads, popups, service workers and WebSockets are blocked, with exact HTTPS host restrictions. This is not Tor Browser and does not promise fingerprint anonymity. Only allow trusted domains; application filtering is not a substitute for host/container network isolation.

## Paid-service replacement assessment

- Claude brain → Kilo free catalog models: implemented for chat, **not Claude Agent SDK feature parity**.
- ElevenLabs TTS → local browser voices: implemented, quality/language availability depends on OS.
- ElevenLabs STT → browser recognition: optional, **not necessarily local/offline**. Local Whisper would need more RAM/CPU and is not installed.
- Search APIs → SearXNG is implemented, including optional Tor-proxied self-hosted Compose service. You must configure an instance; search engines can rate-limit/block Tor exits.
- Image/video APIs → local ComfyUI would defeat the universal 1 GB/no-GPU goal; no fake free gateway promise.
- Browser/device automation → implemented with Playwright and Android ADB, plus user-confirmed one-step proposals. Not full upstream MCP/Claude Agent SDK parity.

## Verification

```sh
npm test
npm run check
```

15 tests cover zero-price guard rejection, memory/history bounds, HTTP auth/origins, fail-closed Tor, search JSON via local HTTP fixtures, action validation, shell-metacharacter rejection, confirmation expiry/replay/cancellation, device allowlists, mock ADB screenshot/commands, mock Playwright navigation/click/fill/allowlists, and low-memory browser refusal. `npm run check` checks server and frontend syntax.

These tests do not contact a live AI provider. Outbound HTTPS to Kilo/Pollinations failed from the implementation sandbox; **successful live generation is unverified**. Chromium download also failed with TLS `ECONNRESET`; no real browser automation or browser UI end-to-end test was possible here. There is no connected Android phone or Docker runtime in the sandbox. Actual ADB/Chromium execution, live SearXNG search, Compose/Tor startup, microphone playback and real 1 GB hardware require deployment testing.

## Sources / provenance

- Original: https://github.com/adewaskar/jarvis — snapshot imported 2026-09-24; HEAD observed as `1c4016afdf86f7043efc6882ceffef84ad0d8783`.
- Upstream MIT license: [`upstream/jarvis/LICENSE`](upstream/jarvis/LICENSE).
- Upstream audio licensing: [`upstream/jarvis/public/audio/CREDITS.md`](upstream/jarvis/public/audio/CREDITS.md); root UI does not play these tracks.
- Kilo API docs: https://kilo.ai/docs/gateway
- Free-model availability and data-handling warning: https://kilo.ai/docs/gateway/models-and-providers

Original upstream dependencies are intentionally not installed by root `npm ci`. The root runtime uses the SOCKS proxy library and `playwright-core`; Chromium is an explicit optional download, not part of `npm ci`.

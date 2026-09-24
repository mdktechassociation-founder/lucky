# Lucky · Free-only JARVIS

A low-overhead, text-first JARVIS with a Kilo cloud brain, explicit free-price checks, optional local device speech and fail-closed Tor routing. **No local model, Claude subscription, ElevenLabs subscription or GPU is needed for this lightweight mode.**

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
| Images, video, web search, device control, MCP tools | **Not implemented in the lightweight app**; no claim that these paid features have been replaced |
| Pollinations | **Not enabled**: live API/pricing could not be verified in the implementation environment. No unverified “unlimited free” fallback |
| Offline intelligence | Not included; cloud chat needs working internet and a available free provider |

“Free” means the app does not intentionally choose a paid model. Providers control quotas, terms, catalog accuracy and future pricing. A catalog check cannot prevent a provider changing billing between requests. Prefer anonymous access or an account with no funded balance and no auto-top-up. There is no quota bypass, account rotation or Tor circuit rotation.

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

Open `http://localhost:3000`. The app is on an internal network, and only the Tor container also has external egress. The SOCKS port is not published to the host. Each container has a 192 MB memory limit; browser/OS/Docker overhead is additional. These are limits, not measured minimum requirements. Docker configuration has not been runtime-tested in this environment.

### No API key required by default

Kilo documents anonymous access for free models. Optional `KILO_API_KEY` stays server-side. Never paste API keys into chat, source files, Git or the browser bundle. The server only supports a fixed Kilo gateway URL, does not follow redirects and never falls back to a different provider/model. `KILO_MODEL` must exist in the live catalog with explicit zero prompt/completion pricing and all other reported pricing fields zero. If catalog format changes, the app intentionally blocks generation until reviewed.

## Hardware adaptation: 1 GB through 64 GB

- Below 2 GB total, or below 384 MB available: lite profile, 6 historical messages maximum, 4,000 context characters, 384 output tokens.
- Otherwise: 16 messages maximum, 12,000 context characters, 1,024 output tokens.
- Limits are recalculated per request. Linux cgroup memory constraints are respected.
- Browser low-motion mode is on by default. UI history is capped at 32 message bubbles. No camera, wake-word listener, 3D rendering or local model is loaded.
- Health metrics describe the **server**, not necessarily the client computer. Browser device-memory hints only affect visual mode.
- **An actual 1 GB whole-system test has not been performed.** A minimal Linux host is the intended target, not a promise that Chrome + a desktop OS will fit in 1 GB. High RAM does not auto-install a heavier local model. GPU presence is irrelevant to this text client.

## Privacy and safety

Tor can hide your source IP from the gateway; **it does not hide prompts, account identifiers, API keys, timing or model outputs from providers**. Kilo warns that auto-free routes may use providers that log data and use it to improve services. Do not send confidential data. Tor exit nodes may be blocked or rate-limited; the app reports an error rather than circumventing those restrictions.

Microphone recognition is not a Tor-proxied backend feature. Browser vendors may process audio remotely; leave it off for a gateway-only privacy route. Voice output only selects voices marked `localService`; unavailable voices result in text-only output. No transcript is persisted by this app; the provider and browser may have their own retention.

This is a single-user assistant, not a hardened multi-tenant public service. It executes no model-generated shell commands or HTML, exposes no file access, and has no spending, mail-sending or device-control tools. Answers are rendered as text. There is no background search or third-party asset loading in the lightweight frontend.

## Paid-service replacement assessment

- Claude brain → Kilo free catalog models: implemented for chat, **not Claude Agent SDK feature parity**.
- ElevenLabs TTS → local browser voices: implemented, quality/language availability depends on OS.
- ElevenLabs STT → browser recognition: optional, **not necessarily local/offline**. Local Whisper would need more RAM/CPU and is not installed.
- Search APIs → self-hosted SearXNG is a possible future integration, but hosting and search-engine availability are not guaranteed; not wired up.
- Image/video APIs → local ComfyUI would defeat the universal 1 GB/no-GPU goal; no fake free gateway promise.
- Browser/device automation → upstream code preserved for reference, not exposed through untrusted free-model tool calls.

## Verification

```sh
npm test
npm run check
```

Tests cover zero-price guard rejection, unknown models, memory profiles, input/history bounds, HTTP authentication, origin checks, static routing and Tor connection failure with no fallback. These tests do not contact a live AI provider. Outbound HTTPS to Kilo/Pollinations failed from the implementation sandbox, so **successful live generation has not been verified**. Tor circuit bootstrapping, microphone/audio playback and real 1 GB hardware require deployment testing.

## Sources / provenance

- Original: https://github.com/adewaskar/jarvis — snapshot imported 2026-09-24; HEAD observed as `1c4016afdf86f7043efc6882ceffef84ad0d8783`.
- Upstream MIT license: [`upstream/jarvis/LICENSE`](upstream/jarvis/LICENSE).
- Upstream audio licensing: [`upstream/jarvis/public/audio/CREDITS.md`](upstream/jarvis/public/audio/CREDITS.md); root UI does not play these tracks.
- Kilo API docs: https://kilo.ai/docs/gateway
- Free-model availability and data-handling warning: https://kilo.ai/docs/gateway/models-and-providers

Original upstream dependencies are intentionally not installed by root `npm ci`. The root runtime has only the SOCKS proxy library and its transitive dependencies.

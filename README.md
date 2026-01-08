# anproto-in

A tiny Deno + browser demo that generates an `an` keypair, signs messages, and delivers them as web push notifications. It includes a minimal UI for key management, subscription toggling, and sending direct push messages to a target pubkey.

## Features

- Client-side keypair generation and signing (`an.js` + `nacl`)
- Web Push subscribe/unsubscribe with VAPID keys
- Signed direct-message push delivery via `/message`
- Optional polling of a latest feed to broadcast updates

## Quick start

1. Run the server:

```bash
DENO_DIR=.deno deno run --allow-net --allow-read --allow-write --allow-env serve.js
```

2. Open `http://localhost:8787` in a browser.
3. Generate a keypair, then share your profile URL (`/#<pubkey>`).
4. Visit a target profile URL and send a push message.
5. Toggle Notifications to subscribe/unsubscribe.

Note: Service workers and push require HTTPS in production. `localhost` works for local dev.

## App flow

- The client stores the combined keypair in `localStorage` under `anproto:keypair`.
- Subscribing requests a challenge from `/subscribe/challenge`, signs it with the private key, and submits the proof to `/subscribe`.
- Sending a message signs the payload hash and POSTs it to `/message` for delivery to subscribers targeting the recipient pubkey.

## Server endpoints

- `GET /vapid-public-key`: returns the VAPID public key.
- `GET /subscribe/challenge?pubkey=...`: issues a short-lived challenge.
- `POST /subscribe`: stores a verified subscription.
- `POST /unsubscribe`: removes a subscription by endpoint.
- `POST /message`: sends a signed direct-message push to matching subscribers.
- `POST /poll-now`: fetches the latest feed once.
- `POST /push-latest`: force-pushes the latest feed even if unchanged.

## Configuration

`notifications_server.js` reads environment variables or falls back to defaults:

- `PORT` (default `8787`)
- `HOST` (default `::`)
- `LATEST_URL` (default `https://pub.wiredove.net/latest`)
- `POLL_MS` (default `15000`)
- `VAPID_CONFIG_PATH` (default `./config.json`)
- `VAPID_SUBJECT` (default `mailto:ops@wiredove.net`)
- `PUSH_ICON_URL` (default `/dovepurple_sm.png`)

VAPID keys are stored in `config.json` (created if missing). Subscriptions and polling state are stored under `data/`.

## Notes

- `serve.js` only serves requests; call `notifications.startPolling()` from code if you want continuous feed polling.
- The UI is intentionally minimal and designed for local experiments.

---
MIT

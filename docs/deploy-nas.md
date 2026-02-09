# UGOS NAS deploy (Docker Compose + Tailscale Funnel)

This repo ships a full-stack Compose setup with:
- `caddy` serving the web UI and proxying `/ws`
- `oauth2-proxy` handling Google SSO + email allowlist
- `server` WebSocket backend
- `tailscale` sidecar exposing Caddy via Funnel

## 1) Create a Google OAuth client

In Google Cloud Console:
1. Create an OAuth 2.0 Client ID (type: Web application).
2. **Authorized redirect URI** must match your Funnel URL exactly:
   - `https://<your-node>.<your-tailnet>.ts.net/oauth2/callback`
3. Save the Client ID and Client Secret.

Important: if you rename the Tailscale node or tailnet, you must update the redirect URI.

## 2) Configure the email allowlist

Edit `ops/oauth2-proxy/emails.yaml` (one email per line):
```
alice@example.com
bob@example.com
```

## 3) Create environment file on the NAS

Create `.env` next to `docker-compose.yml` with at least:
```
# Tailscale
TS_AUTHKEY=tskey-xxxxx
TS_HOSTNAME=livetranslate

# OAuth2 Proxy
OAUTH2_PROXY_CLIENT_ID=your_client_id.apps.googleusercontent.com
OAUTH2_PROXY_CLIENT_SECRET=your_client_secret
OAUTH2_PROXY_COOKIE_SECRET=your_32_byte_base64url_secret
OAUTH2_PROXY_COOKIE_DOMAINS=your-node.your-tailnet.ts.net

# Server
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
GROQ_API_KEY=...
```

Cookie secret must be 16/24/32 bytes (base64url). Example generator:
```
python -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

## 4) Start the stack

```
docker compose up -d
```

## 5) Get your public Funnel URL

Once the `tailscale` container is running:
```
docker compose exec tailscale tailscale funnel status
```

Use that URL when validating the OAuth redirect in Google Console.

## 6) Validate

1. Open the Funnel URL in a browser.
2. You should be redirected to Google SSO.
3. After login, the UI loads and connects to `/ws` on the same host.

## Notes

- Only the Funnel URL is exposed publicly. No other ports are published.
- If you change the Tailscale node hostname, update the Google OAuth redirect URI.

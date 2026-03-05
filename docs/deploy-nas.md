# UGOS NAS deploy (Docker Compose + Tailscale Funnel)

**Environments:** Dev (`pnpm dev`) | Test (local Docker: `pnpm test:docker`) | **Prod** (this guide)

This guide deploys LiveTranslate to a UGOS NAS (e.g. at `192.168.50.186`) with the same stack as test: Docker + Tailscale Funnel + Google OAuth.

This repo ships a full-stack Compose setup with:
- `caddy` serving the web UI and proxying `/ws`
- `oauth2-proxy` handling Google SSO + email allowlist
- `server` WebSocket backend
- `tailscale` sidecar exposing Caddy via Funnel

## 0) Get the code onto the NAS

From your dev machine, clone or rsync the repo to the NAS:

```bash
# Option A: Clone (if NAS has git)
ssh admin@192.168.50.186
cd /path/to/your/apps   # e.g. /volume1/docker/livetranslate
git clone <your-repo-url> .
```

```bash
# Option B: Rsync from your dev machine
rsync -avz --exclude node_modules --exclude .git ./ admin@192.168.50.186:/volume1/docker/livetranslate/
```

Ensure Docker is installed on the NAS. UGOS typically has Docker available via the package manager or admin UI.

## 1) Create a Google OAuth client

In Google Cloud Console:
1. Create an OAuth 2.0 Client ID (type: Web application).
2. **Authorized redirect URI** must match your Funnel URL exactly:
   - `https://<TS_HOSTNAME>.<your-tailnet>.ts.net/oauth2/callback`
   - Example: `https://livetranslate.tailf19888.ts.net/oauth2/callback` if `TS_HOSTNAME=livetranslate` and your tailnet is `tailf19888.ts.net`
3. Save the Client ID and Client Secret.

**Tip:** You can add the redirect URI before starting the stack—the Funnel URL is `https://<TS_HOSTNAME>.<tailnet>/`. Use the same tailnet and hostname you'll set in `.env`.

Important: if you rename the Tailscale node or tailnet, you must update the redirect URI.

## 2) Configure the production email allowlist

Edit `ops/oauth2-proxy/emails.yaml` (one email per line; this is the prod allowlist, separate from `emails.test.yaml` used for test):
```
alice@example.com
bob@example.com
```

## 3) Create production environment file on the NAS

Create `.env` next to `docker-compose.yml` (copy from `.env.example.production` and fill in values). At minimum:
```
# Tailscale
TS_AUTHKEY=tskey-xxxxx
TS_HOSTNAME=livetranslate

# OAuth2 Proxy
OAUTH2_PROXY_CLIENT_ID=your_client_id.apps.googleusercontent.com
OAUTH2_PROXY_CLIENT_SECRET=your_client_secret
OAUTH2_PROXY_COOKIE_SECRET=your_32_byte_base64url_secret
OAUTH2_PROXY_COOKIE_DOMAINS=your-node.your-tailnet.ts.net
OAUTH2_PROXY_REDIRECT_URL=https://your-node.your-tailnet.ts.net/oauth2/callback

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

The `tailscale` service is in the `funnel` profile. Include it to expose the app via Funnel:

```
docker compose --profile funnel up -d
```

Or use the npm script (ensure `.env` exists first):

```
pnpm prod:docker
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

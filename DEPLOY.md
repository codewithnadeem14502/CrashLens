# Deploying crasLens-backend (Oracle Cloud Always Free)

One Oracle Cloud "Always Free" ARM VM runs the whole backend via `docker-compose.yml`
(all 8 services + RabbitMQ + Redis + Caddy for TLS). MongoDB is Atlas, external. This
file is the operational runbook; see the repo's `.claude/rules/real-architecture-reference.md`
(in the parent `crashLens/` workspace) for why this shape was chosen.

## 1. One-time account/VM setup

1. Create an Oracle Cloud account, provision an **Ampere A1 Flex** instance (Always
   Free eligible), Ubuntu 22.04/24.04, e.g. 2-4 OCPU / 12-24 GB. Add your SSH key.
2. Point a domain/subdomain at the VM's public IP (free option: DuckDNS). TLS requires
   this to resolve before Caddy can issue a certificate.
3. Open ports in **both** places (Oracle blocks traffic at two layers):
   - VCN Security List: ingress TCP 80 and 443 from `0.0.0.0/0`.
   - OS firewall (Oracle Ubuntu images default to a restrictive iptables ruleset):
     ```
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
4. Install Docker Engine + the compose plugin:
   ```
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # re-login after this
   ```

## 2. Prepare MongoDB Atlas

- Confirm the M0 cluster exists. **Rotate the DB user's password** if it was ever shared
  outside a secrets manager.
- Atlas → Network Access → allow the VM's public IP (or `0.0.0.0/0` for a quick demo).
- You only need the *base* connection string (no db name) - `docker-compose.yml` appends
  `/<service-name>?retryWrites=false&appName=Cluster0` per service.

## 3. Get the code onto the VM

```
git clone https://github.com/<you>/CrashLens.git
cd CrashLens/crasLens-backend
```

(This repo's `.gitignore` now excludes all `.env` files - only `.env.example` templates
are tracked. If you're deploying an older clone that still has real `.env` files
committed, treat any secrets in them as already leaked and rotate.)

## 4. Configure

```
cp .env.deploy.example .env
```

Fill in `.env`:
- `DOMAIN` - your DuckDNS/domain, already pointed at the VM.
- `MONGODB_BASE_URI` - Atlas base string (no db name, no trailing slash).
- `JWT_SECRET` - `openssl rand -hex 64`. Must be the value every JWT-verifying service
  uses; the compose file already fans this one value out to all six of them.
- `CORS_ALLOWED_ORIGINS` - `https://crash-lens-client.vercel.app` (exact origin).
- SMTP block - optional, only if you want alert-service email notifications.

## 5. Bring it up

```
docker compose --env-file .env up -d --build
docker compose ps                # everything should reach "healthy"
docker compose logs -f api-gateway event-service worker-service issue-service
```

If a build fails on ARM (native module compiling for arm64), check that service's
Dockerfile/package.json for an arch-specific dependency - none are expected today (all
`package.json`s are pure-JS per the repo's zero-native-dependency convention), but this
is the first place to look.

If a service crash-loops, it's almost always because Mongo/RabbitMQ wasn't reachable at
boot (`process.exit(1)` on connect failure by design) - check `MONGODB_BASE_URI` and
Atlas network access first.

## 6. Point the frontend and SDK at it

- Vercel project settings → `VITE_API_BASE_URL=https://<DOMAIN>/v1` → **redeploy**
  (Vite bakes this in at build time; changing the env var alone does nothing until a
  rebuild runs).
- Anyone using the published `crashlens` SDK points at this deployment by passing
  `endpoint: "https://<DOMAIN>/v1/events"` to `init()` - no SDK republish needed.

## 7. Verify end-to-end

1. `curl -i https://<DOMAIN>/v1/auth/login -X POST ...` reaches the gateway over TLS.
2. Register an org, log in, hit an authenticated route (`GET /v1/projects`) with and
   without the bearer token (200 vs 401).
3. Create a project, get its DSN, send a test error event to
   `https://<DOMAIN>/v1/events` with that DSN - confirm it lands as an Issue via
   `GET /v1/issues` (tail `worker-service`/`issue-service` logs to watch it flow through
   RabbitMQ).
4. Open the Vercel app, log in, confirm the dashboard renders with no CORS/mixed-content
   errors in the browser console.
5. Optional: create a monitor + alert rule, confirm the background sweeps fire in the
   logs and a missed check-in surfaces as an Issue.

## Operational notes

- Only `caddy` publishes host ports. Everything else is reachable only inside the
  compose network - this is intentional, do not add host port mappings to the app
  services.
- `monitor-service` and `alert-service` must never run more than 1 replica - their
  `setInterval` sweeps have no leader election and would double-fire.
- RabbitMQ management UI (`:15672`) is not published; reach it via an SSH tunnel:
  `ssh -L 15672:localhost:15672 <user>@<vm-ip>`, then open `http://localhost:15672`.
- `rabbitmq_data`/`redis_data` are named Docker volumes with no external backup - both
  hold only in-flight/derived state, so this is an accepted tradeoff, not an oversight.
- Redeploy after a code change: `git pull && docker compose up -d --build`.

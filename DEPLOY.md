# Deploying crasLens-backend (Hostinger VPS)

One Hostinger KVM VPS runs the whole backend via `docker-compose.yml` (all 8 services +
RabbitMQ + Redis + Caddy for TLS). MongoDB is Atlas, external. This file is the
operational runbook; see the repo's `.claude/rules/real-architecture-reference.md` (in
the parent `crashLens/` workspace) for why this shape was chosen.

Current deployment: KVM 2 (2 vCPU / 8 GB RAM), Ubuntu 24.04, domain `crashlens.online`
(Namecheap), backend at `api.crashlens.online`, frontend (Vercel) at `crashlens.online`
and `www.crashlens.online`.

## 1. One-time account/VM setup

1. Create a Hostinger VPS (KVM 2 or higher recommended - 2 vCPU / 8GB comfortably runs
   all 8 services + RabbitMQ + Redis + Caddy), Ubuntu 24.04. Add your SSH public key
   during creation if the panel offers it; otherwise set a root password and swap to
   key-based auth as the first thing you do after first login:
   ```
   # from your local machine, one-time password login to install the key
   ssh root@<vm-ip>            # authenticate with the password Hostinger gave you
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo "<your-public-key>" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
   ```
   Then, on the VM, disable password auth entirely so only the key works:
   ```
   sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
   sshd -t && systemctl reload ssh
   ```
   Verify the key still logs in successfully **before** closing the session that made
   this change, so you don't lock yourself out.
2. Firewall: Hostinger VPSs ship with no OS-level firewall active by default (wide open,
   not restrictive like some other providers) - lock it down explicitly:
   ```
   apt-get update && apt-get install -y ufw
   ufw allow OpenSSH
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw --force enable
   ```
3. Install Docker Engine + the compose plugin:
   ```
   curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
   sh /tmp/get-docker.sh && rm /tmp/get-docker.sh
   systemctl enable --now docker
   ```

## 2. DNS (Namecheap, or your registrar)

1. Point the backend subdomain at the VM: Advanced DNS → Add New Record → **A Record**,
   Host `api`, Value `<vm-ip>`, TTL Automatic. Caddy (step 5) needs this to already
   resolve before it can obtain a Let's Encrypt certificate - wait for propagation
   (`dig +short api.<domain> @8.8.8.8`) before bringing the stack up.
2. If the domain is also used for the frontend (see step 7), a brand-new domain from a
   registrar usually ships with default parking-page records (a `www` CNAME to the
   registrar's parking page, a `@` URL redirect) - these get replaced in step 7, not now.

## 3. Prepare MongoDB Atlas

- Confirm the M0 (or higher) cluster exists. **Rotate the DB user's password** if it was
  ever shared outside a secrets manager.
- Atlas → **Network Access** → **Add IP Address** → enter the VM's public IP explicitly
  (typing it in, not "Add Current IP Address" - that button adds *your* machine's IP,
  not the VM's). This is the single most common first-deploy failure: every service
  will crash-loop with `MongooseServerSelectionError` / "IP isn't whitelisted" until this
  is done, even though the connection string itself is correct. `auth-service` and
  `project-service` may still show Docker `healthy` during this failure - their `/health`
  route doesn't check DB connectivity, so a green status there is not proof Mongo is
  actually reachable. After adding the IP, `docker compose restart <affected services>`
  to skip the automatic retry backoff.
- You only need the *base* connection string (no db name) - `docker-compose.yml` appends
  `/<service-name>?retryWrites=false&appName=Cluster0` per service.

## 4. Get the code onto the VM

```
git clone https://github.com/<you>/CrashLens.git /opt/crashlens
cd /opt/crashlens
```

If the repo is private, clone with a token embedded in the URL once
(`https://<token>@github.com/...`), then immediately run
`git remote set-url origin https://github.com/<you>/CrashLens.git` to strip the token
back out of the stored remote - don't leave a token sitting in `.git/config`. For repeat
pulls on a private repo, a read-only deploy key (Settings → Deploy keys on the repo,
"Allow write access" unchecked) plus an SSH remote is cleaner than reusing a personal
token. If the repo is public, plain HTTPS clone/pull needs no credentials at all.

(This repo's `.gitignore` excludes all `.env` files - only `.env.example` templates are
tracked. If you're deploying an older clone that still has real `.env` files committed,
treat any secrets in them as already leaked and rotate.)

## 5. Configure

```
cp .env.deploy.example .env
```

Fill in `.env`:
- `DOMAIN` - the subdomain pointed at the VM, e.g. `api.crashlens.online`.
- `MONGODB_BASE_URI` - Atlas base string (no db name, no trailing slash).
- `JWT_SECRET` - generate directly on the VM so it's never typed/pasted anywhere:
  `openssl rand -hex 64`. Must be the value every JWT-verifying service uses; the
  compose file already fans this one value out to all six of them.
- `CORS_ALLOWED_ORIGINS` - comma-separated exact origins allowed to call the gateway
  from a browser, e.g. `https://crash-lens-client.vercel.app,https://crashlens.online,https://www.crashlens.online`.
- SMTP block - optional, only if you want alert-service email notifications.

## 6. Bring it up

```
docker compose --env-file .env config --quiet   # validates before building anything
docker compose --env-file .env up -d --build
docker compose ps                # everything should reach "healthy"
docker compose logs -f api-gateway event-service worker-service issue-service
```

If a service crash-loops, it's almost always because Mongo/RabbitMQ wasn't reachable at
boot (`process.exit(1)` on connect failure by design) - check Atlas Network Access
(step 3) first, then `MONGODB_BASE_URI`. Grep logs for `mongo|error|connect` per service
rather than trusting `docker compose ps`'s health column alone (see step 3's note on
`/health` not checking DB connectivity).

## 7. Point the frontend at it (Vercel)

1. Vercel project settings → Environment Variables → `VITE_API_BASE_URL=https://<DOMAIN>/v1`
   → **redeploy** (Vite bakes this in at build time; changing the env var alone does
   nothing until a rebuild runs).
2. If also moving the frontend onto the new domain: Vercel project → Settings → Domains
   → **Add** → enter the apex (`crashlens.online`) and/or `www` subdomain. Vercel shows
   the exact DNS records it needs (usually an A record for the apex, a CNAME for `www`)
   - copy those exact values into Namecheap's Advanced DNS, replacing the default parking
   records from step 2. Wait for Vercel's domain status to show verified.
3. Once the frontend's real origin(s) are live, make sure `CORS_ALLOWED_ORIGINS` in the
   backend `.env` (step 5) lists them exactly, then
   `docker compose up -d` (recreates only the changed service, api-gateway).
4. Anyone using the published `crashlens` SDK points at this deployment by passing
   `endpoint: "https://<DOMAIN>/v1/events"` to `init()` - no SDK republish needed.

## 8. Verify end-to-end

1. `curl -i https://<DOMAIN>/v1/auth/login -X POST -d '{}'` → expect `400` (Joi
   validation rejecting an empty body), not a 5xx - confirms Caddy → gateway →
   auth-service is wired correctly all the way through.
2. Register an org, log in, hit an authenticated route (`GET /v1/projects`) with and
   without the bearer token (200 vs 401).
3. Create a project, get its DSN, send a test error event to
   `https://<DOMAIN>/v1/events` with that DSN - confirm it lands as an Issue via
   `GET /v1/issues` (tail `worker-service`/`issue-service` logs to watch it flow through
   RabbitMQ).
4. Open the frontend, log in, confirm the dashboard renders with no CORS/mixed-content
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
  `ssh -L 15672:localhost:15672 root@<vm-ip>`, then open `http://localhost:15672`.
- `rabbitmq_data`/`redis_data` are named Docker volumes with no external backup - both
  hold only in-flight/derived state, so this is an accepted tradeoff, not an oversight.
- Redeploy after a code change: `git pull && docker compose up -d --build`.
- Any credential that ever gets pasted somewhere insecure (chat, screenshot, a public
  issue) should be treated as compromised and rotated, even if it "still works" -
  including the SSH key, Atlas password, and JWT_SECRET this deployment used.

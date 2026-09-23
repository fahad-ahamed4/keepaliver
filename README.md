# Cloudflare KeepAlive Manager

A Cloudflare Worker website that lets you add URLs and periodically request them.

## Features

- Add/remove any HTTP/HTTPS URL
- Automatic check every 3 minutes
- Manual "Check now"
- Online/offline status
- HTTP status
- Response time
- Check count and success percentage
- Cloudflare KV persistence
- Cron Trigger
- No BasicDeploy dependency

## Important limitation

This can send periodic HTTP requests to a target site, which may wake a sleeping
application if the hosting provider wakes it on an incoming request.

It cannot guarantee that an external website stays online 100% of the time.
Hosting suspension, DNS failure, provider limits, application crashes, or a
provider's anti-idle policy cannot be overridden by this Worker.

Use it only for websites you are authorized to monitor.

## Cloudflare deployment

### Option A: Cloudflare Dashboard

1. Create a Worker.
2. Upload/deploy the project.
3. Create a KV namespace.
4. Put the KV namespace ID into `wrangler.toml`.
5. Bind the namespace to the Worker with variable name `SITES`.
6. Enable the Cron Trigger: `*/3 * * * *`.
7. Deploy.

### Option B: Wrangler CLI

Install Wrangler:

    npm install

Authenticate:

    npx wrangler login

Create a KV namespace:

    npx wrangler kv namespace create SITES

Copy the returned namespace ID into `wrangler.toml`.

Deploy:

    npm run deploy

## Security note

This version is intentionally simple and has no login system. Do not expose it
publicly if you need private administration. For a public production version,
add Cloudflare Access or another authentication layer.

## Why KV?

KV is suitable for this small URL list and state. For a large multi-user SaaS,
use D1 and authentication instead.

## Cron behavior

Cloudflare Cron invokes the Worker every 3 minutes. The Worker checks all saved
URLs in small batches. The dashboard also lets you trigger a manual check.

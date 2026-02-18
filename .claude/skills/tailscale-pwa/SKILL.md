---
name: tailscale-pwa
description: Walk users through setting up Tailscale HTTPS certificates and installing a PWA on mobile. Use when users need to configure Tailscale for secure access, generate HTTPS certificates, troubleshoot "connection not private" errors, or install a web app as a standalone PWA on their phone.
---

# Tailscale HTTPS + PWA Installation

Walk the user through setting up secure access via Tailscale and installing the app on mobile.

## Step 1: Enable HTTPS in Tailscale

Go to Tailscale admin settings and enable HTTPS certificates for the tailnet.

## Step 2: Get Tailscale Hostname

Run this to find the certificate domain:
```bash
tailscale status --json | jq -r '.CertDomains[0]'
```

If `jq` isn't available, run `tailscale status --json` and look for the `CertDomains` array. The first entry is the hostname.

Example: `macbook.tail12345.ts.net`

## Step 3: Generate Certificates

```bash
tailscale cert <hostname-from-step-2>
```

This creates two files:
- `<hostname>.crt` - certificate
- `<hostname>.key` - private key

Copy to the project's `certs/` directory:
```bash
mkdir -p certs
cp <hostname>.crt certs/cert.pem
cp <hostname>.key certs/key.pem
```

Restart the server to pick up the new certs.

**Note:** Tailscale certs appear in public Certificate Transparency logs. This reveals the hostname exists but not what's served there.

## Step 4: Access via Tailscale URL

Access the app via the Tailscale hostname (not localhost):
```
https://<hostname>.ts.net:<port>
```

Verify the browser shows a secure connection (lock icon, no warnings).

## Step 5: Install the App

On mobile (Chrome):
1. Open the Tailscale URL in Chrome
2. Tap the browser menu (3 dots)
3. Tap "Install app"
4. The app appears on your home screen

The installed app runs in standalone mode (no browser chrome).

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Connection not private" | Missing/invalid certs | Regenerate certs with `tailscale cert`, restart server |
| "Account doesn't support TLS" | HTTPS not enabled | Enable HTTPS in Tailscale admin settings |
| Only "Add to Home Screen" | Not on Tailscale URL or cert issue | Ensure using `https://<hostname>.ts.net`, not localhost |
| Can't connect at all | Not on same tailnet | Ensure both devices are connected to Tailscale |

## Quick Checklist

- [ ] HTTPS enabled in Tailscale admin settings
- [ ] `tailscale status --json` shows CertDomains
- [ ] Certs generated and in `certs/` directory
- [ ] Server restarted after adding certs
- [ ] Accessing via `https://<hostname>.ts.net` (not localhost)
- [ ] Browser shows secure connection (lock icon)
- [ ] Chrome menu shows "Install app" option

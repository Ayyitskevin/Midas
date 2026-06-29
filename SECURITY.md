# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's private vulnerability reporting:

> Repository → **Security** tab → **Report a vulnerability**

We'll acknowledge the report, investigate, and coordinate a fix and disclosure
timeline with you. Thank you for helping keep Midas and its users safe.

## Security posture

Midas is designed to be **self-hosted** and **non-custodial** by default:

- **Your funds never touch Midas.** The terminal reads market data and (when you
  configure a provider) reads from your exchange — it does not custody assets.
- **No order placement** is built in. Midas is a read/analytics terminal.
- **Bring-your-own data source.** With the default `mock` provider, nothing
  leaves your machine. Live providers (`ccxt`, `yahoo`) talk to public market
  endpoints; any exchange credentials you supply stay in your own deployment's
  environment.
- **Optional auth.** Authentication is off by default for a personal local
  instance and can be enabled for shared/hosted deployments.

If you operate a shared or internet-exposed instance, enable authentication, put
it behind TLS, and treat any configured provider credentials as secrets.

## Data honesty is a safety property

Midas treats mislabeling data as a defect: synthetic/delayed/unavailable data is
never presented as live. If you find a place where provenance is wrong or
missing, that's a bug worth reporting (a normal issue is fine for that).

## Supported versions

Midas is pre-1.0 and ships from `main`; fixes land there. Pin a commit for
reproducible deployments.

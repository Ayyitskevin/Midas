# Midas — Vision & Positioning

> **North Star:** Midas is a **self-hosted, command-driven, crypto-native market
> terminal** — Bloomberg-style keyboard muscle memory, pointed at digital assets,
> that you run and own yourself.
>
> **One line:** *The keyboard-first terminal for crypto — own your stack, own your keys.*

This document is the strategic anchor for the project. It is informed by a
verified competitive teardown (see [`docs/research/godel-competitive-teardown.md`](docs/research/godel-competitive-teardown.md)).
Items marked _(recon)_ are pending a hands-on study of the live Gödel Terminal and
will be refined.

---

## The insight — why this wedge

- **Gödel** proved the demand for a modern, command-driven Bloomberg alternative —
  but it is web-only, **equities-first**, and a per-seat SaaS aimed at research desks.
- **OpenBB** owns open-source + self-hosted + AI-agent **data infrastructure** — but
  it is a Python library / API / dashboard product, **not a tight keyboard-driven
  terminal**, and it is AGPL-licensed.
- Crypto has dashboards (TradingView, CoinGecko, Coinglass, DEX screeners) but
  **no one pairs a true Bloomberg-style command UX with crypto-native, multi-exchange
  data that you self-host.**
- **CCXT (MIT)** collapses the crypto data moat: one integration → ~105 exchanges,
  with **public market data that needs no API keys**. A solo builder can ship real,
  broad coverage cheaply and legally. This is the single biggest reason the niche
  is winnable.

**Defensible corner: command-driven × crypto-native × self-hosted.** No incumbent
occupies all three.

---

## Who it's for

**Primary user** — the prosumer crypto trader / independent quant / small-fund analyst who:

- lives on the keyboard and wants speed over mouse-driven dashboards,
- watches many assets across **multiple exchanges** at once,
- wants to **self-host** — own keys, no vendor lock-in, privacy, no per-seat SaaS,
- is comfortable running a local app or Docker container.

**Not (initially):** institutional equities desks (Bloomberg/Gödel territory) or
passive retail (Robinhood/CoinGecko).

---

## Positioning

| | Bloomberg | Gödel | OpenBB | TradingView | **Midas** |
|---|---|---|---|---|---|
| Form factor | desktop + proprietary HW | web SaaS | Python lib / API / dashboards | web charts | **self-hosted app** |
| Interaction | command mnemonics | command mnemonics | CLI / Python / UI | mouse-first | **command-first** |
| Focus | everything (FI-strong) | equities-first multi-asset | data breadth, dev/AI | charting | **crypto-native** |
| Data moat | licensed | licensed | bring-your-own keys | licensed | **CCXT, no keys** |
| Ownership | rented seat | rented seat | open-source | rented seat | **you host it** |
| Price | ~$30k/yr | ~$996/yr | free / OSS + cloud | freemium | **free / self-host** |

---

## The wedge — differentiators

1. **Keyboard-first command grammar tuned for crypto** — e.g. `BTC/USDT GP`,
   `ETH BOOK`, `BTC FUND`, `LIQ`, multi-exchange in the symbol.
2. **Multi-exchange out of the box** via CCXT — compare the same pair across
   Binance / Coinbase / Kraken / … in one workspace.
3. **Self-hosted & key-optional** — own your data path; add exchange API keys only
   if/when you want private account data.
4. **Crypto-native modules** web equities terminals lack — live order book / DOM,
   funding rates, open interest, liquidations, perp basis, on-chain hooks (later).
5. **AI copilot as a feature, not the headline** — an LLM over *your* terminal's
   data and news (summarize, screen, explain). OpenBB already owns the data→agent
   infra layer, so this is a polish feature, not our moat.

**Validated by live recon (Gödel v4.5.2):** Gödel's crypto is **Level-1 only**
(composite + ~4 CEX venues, no L2 depth/DOM), with **no crypto screener** and **no
funding / OI / liquidations** — and the product ships **no AI copilot at all**. Every
one of Midas's crypto-native differentiators maps to confirmed white space, not parity.
See [`docs/research/godel-live-recon.md`](docs/research/godel-live-recon.md).

---

## Product principles

- **Keyboard before mouse.** Every action has a command.
- **Local-first & ownable.** Runs on your machine; your keys never leave it.
- **Pluggable data.** The `DataProvider` interface stays the seam (mock → CCXT → more).
- **Dense, fast, dark.** Information density and sub-second feel are features.
- **Honest data.** Always label real-time vs delayed, the source, and staleness.

## Non-goals (for now)

- Order **execution** / being a trading venue. (Data terminal first; execution is a
  later, opt-in, keys-required module.)
- Full **equities / Bloomberg parity**.
- **Cloud multi-tenant SaaS.** Self-host is the model; a hosted option can come later.

---

## Roadmap

- **Phase 0 — Foundation** ✅ _(shipped)_ — monorepo, command bar, tiling panels,
  pluggable providers (`mock` + `yahoo`), starter modules (DES/GP/W/Q/N/SECF/HELP).
- **Phase 1 — Crypto data layer** — `ccxt` provider (markets/search, tickers, OHLCV,
  order book), crypto symbology (`BASE/QUOTE`), exchange selection, 24/7 market state;
  make crypto the default experience.
- **Phase 2 — Crypto-native modules** — prioritized by confirmed Gödel gaps:
  **L2 order book / DOM** (Gödel is L1-only), **multi-exchange compare** (ALLQ-style across
  CCXT venues), **funding / open interest / liquidations**, a **crypto screener** (Gödel has
  none), and **colored panel-linking groups** (adopt Gödel's best UX).
- **Phase 3 — AI copilot (feature)** — Claude over terminal data + news; an `AI`
  command turning natural language into a panel.
- **Phase 4 — Ownership & polish** — Docker Compose, optional encrypted local key
  vault for private exchange data, saved/named workspaces, packaging.

---

## Decisions (resolved by live recon)

- **Command grammar:** adopt Gödel's ticker-first model; borrow proven codes (`DES`, `FA`,
  `G`/`GIP`, `QM`, `N`, `ALLQ`, `MOST`, `SECF`) where they fit crypto. Our `GP` stays for charts.
- **Module priority:** L2 order book/DOM → multi-exchange compare → funding/OI/liquidations →
  crypto screener → panel-linking → AI copilot (the confirmed-gap order).
- **Panel linking:** adopt colored link groups (Gödel's strongest UX) — and *also* let the
  command bar drive linked panels (fixing Gödel's command-bar-vs-link confusion).
- **AI copilot:** a genuine differentiator, not parity — Gödel ships none.

Still open:
- **License** — MIT (max adoption) vs. source-available.
- **Default exchange**, and whether to aggregate quotes across exchanges by default.

---

## Why "Midas"

The Midas touch — everything to gold. A terminal that turns raw market data into
signal you **own**. The brand story is **ownership**: your terminal, your keys,
your stack — the opposite of a rented seat on someone else's aging tech.

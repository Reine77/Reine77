# Trading Bot: Multi-Strategy Scanner + Telegram Confirm

Scans the top N pairs by volume (plus any symbols you pin, e.g. BTC/USDT,
ETH/USDT) on a major exchange, checks each one against a configurable
strategy, and sends you a Telegram message with **Confirm** / **Skip**
buttons instead of trading automatically. Nothing executes until you tap
Confirm. A web settings page (see below) lets you configure all of this —
exchange, LLM, strategy, and parameters — without hand-editing files.

## How it works

1. `src/exchange.py` — a [ccxt](https://github.com/ccxt/ccxt) wrapper.
   Supports Binance, Kucoin, Coinbase, OKX, and Bybit (any ccxt id in
   general); just change `exchange:` in `config.yaml`.
2. `src/strategies/` — a registry of pluggable strategies. Each returns
   `"buy"`, `"sell"`, or `None` for the latest closed candle. Included:
   - **MA Crossover** — fast/slow moving average cross (EMA or SMA).
   - **RSI Oversold/Overbought** — buy on recovery above the oversold line,
     sell on drop below the overbought line.
   - **Bollinger Bands Touch** — buy/sell the bar price first closes beyond
     a band.
   - **MACD Crossover** — MACD line crossing its signal line.
   - **Stochastic Oscillator** — %K/%D crossover confirmed in the
     oversold/overbought zone.

   Add a new one by dropping a module in `src/strategies/` with a `NAME`,
   `LABEL`, `PARAMS` (for the web UI's form fields), and a `detect(df,
   params)` function, then listing it in `src/strategies/__init__.py`.
3. `src/scanner.py` — polls the watchlist on an interval, and only fires a
   notification when a symbol's signal actually changes (no repeat spam
   every tick).
4. `src/llm.py` — optional second opinion. If an LLM provider + key are
   configured, each signal is run past it for a 2-3 sentence sanity check
   before you decide. Supports OpenAI, Anthropic, Gemini, Grok, and
   Mistral. Any failure here is swallowed — Confirm/Skip works with or
   without it.
5. `src/notifier.py` — sends the signal (+ LLM opinion, if enabled) to your
   Telegram chat with Confirm/Skip buttons. Confirm triggers a market order
   via ccxt; Skip just dismisses it.
6. `src/main.py` — wires it all together and runs the poll loop.
7. `webapp/` — a small FastAPI settings page (see below) that reads/writes
   `config.yaml` and `.env` so you don't have to edit them by hand.

### Why not Pine Script / TradingView?

Pine Script only executes on TradingView's own servers — there's no direct
API to "connect" to it. Every strategy here is reimplemented directly in
Python against the same OHLCV candles pulled from the exchange, so there's
no TradingView dependency, webhook relay, or paid plan required.

### Spot vs perpetual futures (swap)

Set `market_type: swap` in `config.yaml` to trade USDT-margined perpetuals
instead of spot. A few things change in this mode:

- **A "sell" signal opens a short**, it does not close an existing long —
  there's no position-management/close/take-profit logic here, only
  entries on confirmed signals. Telegram labels switch to `OPEN LONG` /
  `OPEN SHORT` so this isn't confused with spot buy/sell.
- **`leverage` and `margin_mode`** (in `config.yaml`) are applied per symbol
  the first time an order is confirmed for it. Leverage only reduces the
  margin needed to open a given position size — `order_amount_quote` is
  still the position's notional size, not the margin, so liquidation risk
  scales directly with leverage.
- **Kucoin futures use a separate API key** from Kucoin spot — create it
  under Kucoin's Futures API management (not the spot one) with Futures
  trading permission. Binance futures reuse the same key, but you must
  enable "Futures" on that API key and have a funded USDT-M futures wallet.
- **`extra_symbols` needs the unified swap format** in this mode, e.g.
  `BTC/USDT:USDT` rather than `BTC/USDT`.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Either edit `config.yaml`/`.env` by hand, or use the web settings page:

```bash
uvicorn webapp.server:app --port 8000
```

Open `http://127.0.0.1:8000` — pick your exchange, paste API keys, pick a
strategy and edit its parameters (fields update per-strategy), optionally
enable an LLM second opinion, and fill in Telegram. Saving writes straight
to `config.yaml` (non-secret settings) and `.env` (API keys, tokens) —
restart the bot process afterwards to pick up changes.

**This settings page has no login of its own and writes API keys to local
files.** `uvicorn` binds to `127.0.0.1` by default — leave it that way.
Don't put it behind `--host 0.0.0.0` or expose it to the internet without
adding real authentication first.

Either way, you'll need:

- **Exchange API key/secret** — only needs trade permission if you set
  `dry_run: false`. Read-only keys are enough while testing. Never grant
  withdrawal permission.
- **Exchange API passphrase** — Kucoin only.
- **Telegram bot token + chat ID** — create a bot via
  [@BotFather](https://t.me/BotFather), message it once, then visit
  `https://api.telegram.org/bot<token>/getUpdates` to read your chat ID.
- **LLM API key** — optional, only needed if you enable the second-opinion
  feature.

**Leave `dry_run: true` until you've watched the bot call signals
correctly** — in dry-run mode confirmed trades are logged, not sent to the
exchange.

Run it:

```bash
python -m src.main
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

Covers strategy signal detection (`tests/test_strategies.py`, hand-verified
buy/sell cases for all 5 strategies) and config loading
(`tests/test_config.py`).

## Safety notes

- Start with `dry_run: true` and small `order_amount_quote` once you flip it
  off.
- API keys only need trade permission, never withdrawal permission.
- Every strategy here will produce false signals in the wrong market regime
  (crossovers whipsaw in chop, oscillators can stay pinned in a strong
  trend). The LLM second opinion is a sanity check, not a backtest — none
  of this is financial advice. Validate against historical data before
  trusting any strategy with real funds.

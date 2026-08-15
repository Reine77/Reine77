# Trading Bot: MA Crossover Scanner + Telegram Confirm

Scans the top N pairs by volume (plus any symbols you pin, e.g. BTC/USDT,
ETH/USDT) on Binance or Kucoin, checks each one for a moving-average
crossover, and sends you a Telegram message with **Confirm** / **Skip**
buttons instead of trading automatically. Nothing executes until you tap
Confirm.

## How it works

1. `src/exchange.py` — a [ccxt](https://github.com/ccxt/ccxt) wrapper. Same
   code path works for Binance, Kucoin, or any other ccxt-supported exchange;
   just change `exchange:` in `config.yaml`.
2. `src/strategy.py` — computes a fast/slow moving average (EMA or SMA) and
   flags a `bullish_cross` or `bearish_cross` on the most recently closed
   candle.
3. `src/scanner.py` — polls the watchlist on an interval, and only fires a
   notification when a symbol's crossover state actually changes (no repeat
   spam every tick).
4. `src/notifier.py` — sends the signal to your Telegram chat with
   Confirm/Skip buttons. Confirm triggers a market order via ccxt; Skip just
   dismisses it.
5. `src/main.py` — wires it all together and runs the poll loop.

### Why not Pine Script / TradingView?

Pine Script only executes on TradingView's own servers — there's no direct
API to "connect" to it. The crossover logic here is reimplemented directly
in Python against the same OHLCV candles pulled from the exchange, so there's
no TradingView dependency, webhook relay, or paid plan required. If you later
want to prototype strategies visually before coding them, TradingView is
still a fine place to do that — just port the finished rule into
`src/strategy.py`.

### Spot vs perpetual futures (swap)

Set `market_type: swap` in `config.yaml` to trade USDT-margined perpetuals
instead of spot. A few things change in this mode:

- **A "sell" signal opens a short**, it does not close an existing long —
  there's no position-management/close/take-profit logic here, only
  entries on confirmed crossovers. Telegram labels switch to `OPEN LONG` /
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

Fill in `.env`:

- `EXCHANGE_API_KEY` / `EXCHANGE_API_SECRET` — only need trade permission if
  you set `dry_run: false`. Read-only keys are enough while testing.
- `EXCHANGE_API_PASSWORD` — Kucoin's API passphrase (leave blank for Binance).
- `TELEGRAM_BOT_TOKEN` — create a bot via [@BotFather](https://t.me/BotFather).
- `TELEGRAM_CHAT_ID` — message your new bot once, then visit
  `https://api.telegram.org/bot<token>/getUpdates` and read the chat id back.

Adjust `config.yaml`: exchange, quote currency, watchlist size/pins,
timeframe, MA periods (`fast_ma`/`slow_ma`), poll interval, and order size.
**Leave `dry_run: true` until you've watched it call signals correctly** —
in dry-run mode confirmed trades are logged, not sent to the exchange.

Run it:

```bash
python -m src.main
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

Covers the crossover detection math (`tests/test_strategy.py`) with
hand-verified bullish/bearish/no-signal/insufficient-data cases.

## Safety notes

- Start with `dry_run: true` and small `order_amount_quote` once you flip it
  off.
- API keys only need trade permission, never withdrawal permission.
- This is a simple two-MA crossover; it will produce false signals in choppy
  markets like any crossover strategy. Nothing here is financial advice —
  validate against historical data before trusting it with real funds.

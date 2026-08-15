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

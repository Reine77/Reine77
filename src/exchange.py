import logging

import ccxt
import pandas as pd

logger = logging.getLogger(__name__)

# Some exchanges expose futures through a distinct ccxt class rather than a
# defaultType switch on the spot class. Kucoin is the main one here: spot is
# `kucoin`, USDT-margined perpetuals are the separate `kucoinfutures` class
# with its own API key/permissions. Binance uses one class with a
# defaultType option instead, so it's not listed here.
SWAP_CLASS_OVERRIDES = {"kucoin": "kucoinfutures"}


class ExchangeClient:
    """Thin wrapper around ccxt so the rest of the bot doesn't care which
    exchange it's talking to (Binance, Kucoin, or any other ccxt id), or
    whether it's trading spot or USDT-margined perpetual swaps."""

    def __init__(self, config):
        self.config = config
        self.is_swap = config.market_type == "swap"
        self._leverage_configured = set()

        class_id = SWAP_CLASS_OVERRIDES.get(config.exchange_id, config.exchange_id) if self.is_swap else config.exchange_id
        exchange_class = getattr(ccxt, class_id)

        params = {
            "apiKey": config.exchange_api_key,
            "secret": config.exchange_api_secret,
            "enableRateLimit": True,
        }
        if config.exchange_api_password:
            params["password"] = config.exchange_api_password
        if self.is_swap and class_id == config.exchange_id:
            # Exchanges (e.g. Binance) that share one class for spot/futures
            # and switch markets via defaultType instead of a separate class.
            params["options"] = {"defaultType": "future"}

        self.exchange = exchange_class(params)
        self.markets = self.exchange.load_markets()

    def get_watchlist(self):
        """extra_symbols (always included) + top_n pairs by 24h quote volume,
        restricted to spot or USDT-margined linear swap markets depending on
        market_type."""
        tickers = self.exchange.fetch_tickers()
        quote = self.config.quote_currency

        ranked = []
        for symbol, market in self.markets.items():
            if not market.get("active", True):
                continue
            if market.get("quote") != quote:
                continue

            if self.is_swap:
                if not market.get("swap") or not market.get("linear"):
                    continue
                if market.get("settle") != quote:
                    continue
            elif not market.get("spot", True):
                continue

            ticker = tickers.get(symbol)
            if not ticker:
                continue
            ranked.append((symbol, ticker.get("quoteVolume") or 0))

        ranked.sort(key=lambda pair: pair[1], reverse=True)
        top_symbols = [symbol for symbol, _ in ranked[: self.config.top_n]]

        # dict.fromkeys preserves order while deduping extra_symbols vs top_symbols
        return list(dict.fromkeys(self.config.extra_symbols + top_symbols))

    def fetch_ohlcv_df(self, symbol, limit=200):
        raw = self.exchange.fetch_ohlcv(symbol, timeframe=self.config.timeframe, limit=limit)
        return pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])

    def _ensure_leverage_and_margin(self, symbol):
        if symbol in self._leverage_configured:
            return
        try:
            self.exchange.set_margin_mode(self.config.margin_mode, symbol)
        except Exception as exc:
            logger.warning("Could not set margin mode for %s: %s", symbol, exc)
        try:
            self.exchange.set_leverage(self.config.leverage, symbol)
        except Exception as exc:
            logger.warning("Could not set leverage for %s: %s", symbol, exc)
        self._leverage_configured.add(symbol)

    def place_market_order(self, symbol, side, amount_quote):
        """amount_quote is the position's notional size, not the margin used —
        leverage lowers the margin required to open it, it doesn't change the
        order size itself."""
        if self.config.dry_run:
            logger.info("[DRY RUN] %s %s worth %.2f %s", side, symbol, amount_quote, self.config.quote_currency)
            return {"dry_run": True, "symbol": symbol, "side": side, "amount_quote": amount_quote}

        if self.is_swap:
            self._ensure_leverage_and_margin(symbol)

        ticker = self.exchange.fetch_ticker(symbol)
        amount = self.exchange.amount_to_precision(symbol, amount_quote / ticker["last"])
        return self.exchange.create_order(symbol, type="market", side=side, amount=amount)

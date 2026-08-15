import logging

import ccxt
import pandas as pd

logger = logging.getLogger(__name__)


class ExchangeClient:
    """Thin wrapper around ccxt so the rest of the bot doesn't care which
    exchange it's talking to (Binance, Kucoin, or any other ccxt id)."""

    def __init__(self, config):
        self.config = config
        exchange_class = getattr(ccxt, config.exchange_id)
        params = {
            "apiKey": config.exchange_api_key,
            "secret": config.exchange_api_secret,
            "enableRateLimit": True,
        }
        if config.exchange_api_password:
            params["password"] = config.exchange_api_password
        self.exchange = exchange_class(params)
        self.markets = self.exchange.load_markets()

    def get_watchlist(self):
        """extra_symbols (always included) + top_n spot pairs by 24h quote volume."""
        tickers = self.exchange.fetch_tickers()
        quote = self.config.quote_currency

        ranked = []
        for symbol, market in self.markets.items():
            if not market.get("spot", True):
                continue
            if market.get("quote") != quote:
                continue
            if not market.get("active", True):
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

    def place_market_order(self, symbol, side, amount_quote):
        if self.config.dry_run:
            logger.info("[DRY RUN] %s %s worth %.2f %s", side, symbol, amount_quote, self.config.quote_currency)
            return {"dry_run": True, "symbol": symbol, "side": side, "amount_quote": amount_quote}

        ticker = self.exchange.fetch_ticker(symbol)
        amount = amount_quote / ticker["last"]
        return self.exchange.create_order(symbol, type="market", side=side, amount=amount)

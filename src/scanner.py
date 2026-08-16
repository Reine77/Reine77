import logging

from src.strategies import detect_signal

logger = logging.getLogger(__name__)


class SignalScanner:
    """Scans the watchlist each tick and notifies only on a fresh signal
    (i.e. skips repeat notifications while the same buy/sell state persists)."""

    def __init__(self, config, exchange_client, notifier):
        self.config = config
        self.exchange = exchange_client
        self.notifier = notifier
        self.last_signal = {}

    async def scan_once(self):
        watchlist = self.exchange.get_watchlist()
        logger.info(
            "Scanning %d symbols with %s: %s", len(watchlist), self.config.strategy_name, watchlist
        )

        for symbol in watchlist:
            try:
                df = self.exchange.fetch_ohlcv_df(symbol)
                side = detect_signal(self.config.strategy_name, df, self.config.strategy_params)
            except Exception:
                logger.exception("Failed to process %s", symbol)
                continue

            if side is None or self.last_signal.get(symbol) == side:
                continue

            self.last_signal[symbol] = side
            price = df["close"].iloc[-1]
            logger.info("%s: %s -> notifying", symbol, side)
            await self.notifier.send_signal(symbol, side, price)

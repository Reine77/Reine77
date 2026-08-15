import logging

from src.strategy import detect_crossover

logger = logging.getLogger(__name__)

SIGNAL_TO_SIDE = {"bullish_cross": "buy", "bearish_cross": "sell"}


class SignalScanner:
    """Scans the watchlist each tick and notifies only on a fresh crossover
    (i.e. skips repeat notifications while the same cross state persists)."""

    def __init__(self, config, exchange_client, notifier):
        self.config = config
        self.exchange = exchange_client
        self.notifier = notifier
        self.last_signal = {}

    async def scan_once(self):
        watchlist = self.exchange.get_watchlist()
        logger.info("Scanning %d symbols: %s", len(watchlist), watchlist)

        for symbol in watchlist:
            try:
                df = self.exchange.fetch_ohlcv_df(symbol)
                signal = detect_crossover(df, self.config.fast_ma, self.config.slow_ma, self.config.ma_type)
            except Exception:
                logger.exception("Failed to process %s", symbol)
                continue

            if signal is None or self.last_signal.get(symbol) == signal:
                continue

            self.last_signal[symbol] = signal
            side = SIGNAL_TO_SIDE[signal]
            price = df["close"].iloc[-1]
            logger.info("%s: %s -> notifying", symbol, signal)
            await self.notifier.send_signal(symbol, side, price)

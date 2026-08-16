import logging

from telegram.ext import ContextTypes

from src.config import load_config
from src.exchange import ExchangeClient
from src.llm import LLMAdvisor
from src.notifier import TelegramNotifier
from src.scanner import SignalScanner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def build_app():
    config = load_config()
    exchange_client = ExchangeClient(config)
    llm_advisor = LLMAdvisor(config.llm_provider, config.llm_api_key, config.llm_model)

    async def on_confirm(symbol, side, price):
        return exchange_client.place_market_order(symbol, side, config.order_amount_quote)

    notifier = TelegramNotifier(config, on_confirm, llm_advisor)
    scanner = SignalScanner(config, exchange_client, notifier)

    async def scan_job(context: ContextTypes.DEFAULT_TYPE):
        await scanner.scan_once()

    notifier.app.job_queue.run_repeating(scan_job, interval=config.poll_interval_seconds, first=5)
    return notifier.app


def main():
    app = build_app()
    logger.info("Starting trading bot")
    app.run_polling()


if __name__ == "__main__":
    main()

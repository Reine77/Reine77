import os
from dataclasses import dataclass
from typing import List

import yaml
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    exchange_id: str
    exchange_api_key: str
    exchange_api_secret: str
    exchange_api_password: str
    telegram_bot_token: str
    telegram_chat_id: str
    quote_currency: str
    top_n: int
    extra_symbols: List[str]
    timeframe: str
    fast_ma: int
    slow_ma: int
    ma_type: str
    poll_interval_seconds: int
    order_amount_quote: float
    dry_run: bool
    market_type: str
    leverage: float
    margin_mode: str


def load_config(path: str = "config.yaml") -> Config:
    with open(path) as f:
        raw = yaml.safe_load(f)

    return Config(
        exchange_id=raw["exchange"],
        exchange_api_key=os.environ.get("EXCHANGE_API_KEY", ""),
        exchange_api_secret=os.environ.get("EXCHANGE_API_SECRET", ""),
        exchange_api_password=os.environ.get("EXCHANGE_API_PASSWORD", ""),
        telegram_bot_token=os.environ["TELEGRAM_BOT_TOKEN"],
        telegram_chat_id=os.environ["TELEGRAM_CHAT_ID"],
        quote_currency=raw.get("quote_currency", "USDT"),
        top_n=raw.get("top_n", 10),
        extra_symbols=raw.get("extra_symbols", []),
        timeframe=raw.get("timeframe", "1h"),
        fast_ma=raw.get("fast_ma", 9),
        slow_ma=raw.get("slow_ma", 21),
        ma_type=raw.get("ma_type", "ema"),
        poll_interval_seconds=raw.get("poll_interval_seconds", 300),
        order_amount_quote=raw.get("order_amount_quote", 50),
        dry_run=raw.get("dry_run", True),
        market_type=raw.get("market_type", "spot"),
        leverage=raw.get("leverage", 2),
        margin_mode=raw.get("margin_mode", "isolated"),
    )

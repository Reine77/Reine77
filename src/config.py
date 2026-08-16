import os
from dataclasses import dataclass, field
from typing import Dict, List

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
    poll_interval_seconds: int
    order_amount_quote: float
    dry_run: bool
    market_type: str
    leverage: float
    margin_mode: str
    strategy_name: str
    strategy_params: Dict = field(default_factory=dict)
    llm_provider: str = ""
    llm_model: str = ""
    llm_api_key: str = ""


def load_config(path: str = "config.yaml") -> Config:
    with open(path) as f:
        raw = yaml.safe_load(f)

    strategy = raw.get("strategy", {}) or {}
    llm = raw.get("llm", {}) or {}

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
        poll_interval_seconds=raw.get("poll_interval_seconds", 300),
        order_amount_quote=raw.get("order_amount_quote", 50),
        dry_run=raw.get("dry_run", True),
        market_type=raw.get("market_type", "spot"),
        leverage=raw.get("leverage", 2),
        margin_mode=raw.get("margin_mode", "isolated"),
        strategy_name=strategy.get("name", "ma_crossover"),
        strategy_params=strategy.get("params", {}),
        llm_provider=llm.get("provider", ""),
        llm_model=llm.get("model", ""),
        llm_api_key=os.environ.get("LLM_API_KEY", ""),
    )

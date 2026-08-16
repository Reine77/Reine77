import logging
from pathlib import Path
from typing import Dict, List

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from src.strategies import REGISTRY

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.yaml"
ENV_PATH = BASE_DIR / ".env"
INDEX_PATH = Path(__file__).resolve().parent / "index.html"

# Exchanges ccxt supports well for both spot and USDT-margined perpetuals.
EXCHANGES = ["binance", "kucoin", "coinbase", "okx", "bybit"]
LLM_PROVIDERS = ["openai", "anthropic", "gemini", "grok", "mistral"]

# Secrets never touch config.yaml — they live only in .env, which is
# gitignored. This is the exhaustive list of keys this page manages there.
ENV_KEYS = [
    "EXCHANGE_API_KEY",
    "EXCHANGE_API_SECRET",
    "EXCHANGE_API_PASSWORD",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "LLM_API_KEY",
]

app = FastAPI(title="Trading Bot Settings")


class Settings(BaseModel):
    exchange: str
    exchange_api_key: str = ""
    exchange_api_secret: str = ""
    exchange_api_password: str = ""
    market_type: str = "spot"
    leverage: float = 2
    margin_mode: str = "isolated"
    quote_currency: str = "USDT"
    top_n: int = 10
    extra_symbols: List[str] = []
    timeframe: str = "1h"
    poll_interval_seconds: int = 300
    order_amount_quote: float = 50
    dry_run: bool = True
    strategy_name: str
    strategy_params: Dict = {}
    llm_provider: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""


def _read_env() -> Dict[str, str]:
    values = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def _write_env(values: Dict[str, str]) -> None:
    lines = [f"{key}={values.get(key, '')}" for key in ENV_KEYS]
    ENV_PATH.write_text("\n".join(lines) + "\n")


@app.get("/", response_class=HTMLResponse)
def index():
    return INDEX_PATH.read_text()


@app.get("/api/meta")
def get_meta():
    return {
        "exchanges": EXCHANGES,
        "llm_providers": LLM_PROVIDERS,
        "strategies": {
            name: {"label": module.LABEL, "params": module.PARAMS} for name, module in REGISTRY.items()
        },
    }


@app.get("/api/settings")
def get_settings():
    config = {}
    if CONFIG_PATH.exists():
        config = yaml.safe_load(CONFIG_PATH.read_text()) or {}
    env = _read_env()
    strategy = config.get("strategy", {}) or {}
    llm = config.get("llm", {}) or {}

    return {
        "exchange": config.get("exchange", "binance"),
        "exchange_api_key": env.get("EXCHANGE_API_KEY", ""),
        "exchange_api_secret": env.get("EXCHANGE_API_SECRET", ""),
        "exchange_api_password": env.get("EXCHANGE_API_PASSWORD", ""),
        "market_type": config.get("market_type", "spot"),
        "leverage": config.get("leverage", 2),
        "margin_mode": config.get("margin_mode", "isolated"),
        "quote_currency": config.get("quote_currency", "USDT"),
        "top_n": config.get("top_n", 10),
        "extra_symbols": config.get("extra_symbols", []),
        "timeframe": config.get("timeframe", "1h"),
        "poll_interval_seconds": config.get("poll_interval_seconds", 300),
        "order_amount_quote": config.get("order_amount_quote", 50),
        "dry_run": config.get("dry_run", True),
        "strategy_name": strategy.get("name", "ma_crossover"),
        "strategy_params": strategy.get("params", {}),
        "llm_provider": llm.get("provider", ""),
        "llm_model": llm.get("model", ""),
        "llm_api_key": env.get("LLM_API_KEY", ""),
        "telegram_bot_token": env.get("TELEGRAM_BOT_TOKEN", ""),
        "telegram_chat_id": env.get("TELEGRAM_CHAT_ID", ""),
    }


@app.post("/api/settings")
def save_settings(settings: Settings):
    if settings.strategy_name not in REGISTRY:
        raise HTTPException(status_code=400, detail=f"Unknown strategy: {settings.strategy_name}")
    if settings.exchange not in EXCHANGES:
        raise HTTPException(status_code=400, detail=f"Unknown exchange: {settings.exchange}")
    if settings.llm_provider and settings.llm_provider not in LLM_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown LLM provider: {settings.llm_provider}")

    config = {
        "exchange": settings.exchange,
        "quote_currency": settings.quote_currency,
        "top_n": settings.top_n,
        "extra_symbols": settings.extra_symbols,
        "timeframe": settings.timeframe,
        "strategy": {"name": settings.strategy_name, "params": settings.strategy_params},
        "llm": {"provider": settings.llm_provider, "model": settings.llm_model},
        "poll_interval_seconds": settings.poll_interval_seconds,
        "order_amount_quote": settings.order_amount_quote,
        "dry_run": settings.dry_run,
        "market_type": settings.market_type,
        "leverage": settings.leverage,
        "margin_mode": settings.margin_mode,
    }
    CONFIG_PATH.write_text(yaml.safe_dump(config, sort_keys=False))

    env_values = _read_env()
    env_values.update(
        {
            "EXCHANGE_API_KEY": settings.exchange_api_key,
            "EXCHANGE_API_SECRET": settings.exchange_api_secret,
            "EXCHANGE_API_PASSWORD": settings.exchange_api_password,
            "TELEGRAM_BOT_TOKEN": settings.telegram_bot_token,
            "TELEGRAM_CHAT_ID": settings.telegram_chat_id,
            "LLM_API_KEY": settings.llm_api_key,
        }
    )
    _write_env(env_values)

    return {"ok": True}

from src.config import load_config


def _write_config(tmp_path, extra=""):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(f"exchange: binance\n{extra}")
    return str(config_file)


def test_spot_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:test")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    config = load_config(_write_config(tmp_path))
    assert config.market_type == "spot"
    assert config.leverage == 2
    assert config.margin_mode == "isolated"


def test_swap_overrides(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:test")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")
    config = load_config(_write_config(tmp_path, "market_type: swap\nleverage: 5\nmargin_mode: cross\n"))
    assert config.market_type == "swap"
    assert config.leverage == 5
    assert config.margin_mode == "cross"

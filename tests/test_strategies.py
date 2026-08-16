import pandas as pd
import pytest

from src.strategies import detect_signal, get_strategy, resolve_params


def make_df(closes, highs=None, lows=None):
    data = {"close": closes}
    if highs is not None:
        data["high"] = highs
    if lows is not None:
        data["low"] = lows
    return pd.DataFrame(data)


def test_unknown_strategy_raises():
    with pytest.raises(ValueError):
        get_strategy("not_a_real_strategy")


def test_resolve_params_applies_overrides():
    params = resolve_params("ma_crossover", {"fast_period": 5})
    assert params["fast_period"] == 5
    assert params["slow_period"] == 21  # default untouched


# --- MA crossover ---


def test_ma_crossover_buy():
    closes = [10.0] * 20 + [9.0, 8.0, 7.0, 6.0, 15.0, 20.0]
    df = make_df(closes)
    assert detect_signal("ma_crossover", df, {"fast_period": 3, "slow_period": 10, "ma_type": "sma"}) == "buy"


def test_ma_crossover_sell():
    closes = [10.0] * 20 + [11.0, 12.0, 13.0, 14.0, 5.0, 2.0]
    df = make_df(closes)
    assert detect_signal("ma_crossover", df, {"fast_period": 3, "slow_period": 10, "ma_type": "sma"}) == "sell"


def test_ma_crossover_insufficient_data_returns_none():
    df = make_df([10.0, 11.0, 12.0])
    assert detect_signal("ma_crossover", df, {"fast_period": 9, "slow_period": 21}) is None


# --- RSI ---


def test_rsi_buy_on_recovery_above_oversold():
    closes = [100.0]
    for _ in range(16):
        closes.append(closes[-1] * 0.99)
    closes.append(closes[-1] * 1.08)
    df = make_df(closes)
    assert detect_signal("rsi", df, {"period": 14}) == "buy"


def test_rsi_sell_on_drop_below_overbought():
    closes = [100.0]
    for _ in range(16):
        closes.append(closes[-1] * 1.01)
    closes.append(closes[-1] * 0.92)
    df = make_df(closes)
    assert detect_signal("rsi", df, {"period": 14}) == "sell"


# --- Bollinger Bands ---


def test_bollinger_buy_on_lower_band_touch():
    closes = [100.0] * 25 + [95.0]
    df = make_df(closes)
    assert detect_signal("bollinger_bands", df, {"period": 20, "std_dev": 2.0}) == "buy"


def test_bollinger_sell_on_upper_band_touch():
    closes = [100.0] * 25 + [105.0]
    df = make_df(closes)
    assert detect_signal("bollinger_bands", df, {"period": 20, "std_dev": 2.0}) == "sell"


# --- MACD ---


def test_macd_buy_crossover():
    closes = [100.0] * 40 + [90.0, 85.0, 80.0, 78.0, 95.0, 110.0]
    df = make_df(closes)
    assert detect_signal("macd", df, {}) == "buy"


def test_macd_sell_crossover():
    closes = [100.0] * 40 + [110.0, 115.0, 120.0, 122.0, 105.0, 90.0]
    df = make_df(closes)
    assert detect_signal("macd", df, {}) == "sell"


# --- Stochastic ---


def test_stochastic_buy_on_oversold_crossover():
    highs, lows, closes = [100.0], [99.0], [99.5]
    for _ in range(20):
        highs.append(highs[-1] * 0.99)
        lows.append(lows[-1] * 0.99)
        closes.append(closes[-1] * 0.99)
    highs.append(highs[-1] * 1.02)
    lows.append(lows[-1])
    closes.append(closes[-1] * 1.02)

    df = make_df(closes, highs, lows)
    assert detect_signal("stochastic", df, {"k_period": 14, "d_period": 3}) == "buy"


def test_stochastic_sell_on_overbought_crossover():
    highs, lows, closes = [100.0], [99.0], [99.5]
    for _ in range(20):
        highs.append(highs[-1] * 1.01)
        lows.append(lows[-1] * 1.01)
        closes.append(closes[-1] * 1.01)
    highs.append(highs[-1])
    lows.append(lows[-1] * 0.98)
    closes.append(closes[-1] * 0.98)

    df = make_df(closes, highs, lows)
    assert detect_signal("stochastic", df, {"k_period": 14, "d_period": 3}) == "sell"

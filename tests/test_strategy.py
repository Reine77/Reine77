import pandas as pd

from src.strategy import detect_crossover


def make_df(closes):
    return pd.DataFrame({"close": closes})


def test_bullish_crossover_detected():
    closes = [10.0] * 20 + [9.0, 8.0, 7.0, 6.0, 15.0, 20.0]
    df = make_df(closes)
    assert detect_crossover(df, fast_period=3, slow_period=10, ma_type="sma") == "bullish_cross"


def test_bearish_crossover_detected():
    closes = [10.0] * 20 + [11.0, 12.0, 13.0, 14.0, 5.0, 2.0]
    df = make_df(closes)
    assert detect_crossover(df, fast_period=3, slow_period=10, ma_type="sma") == "bearish_cross"


def test_no_signal_when_flat():
    closes = [10.0] * 30
    df = make_df(closes)
    assert detect_crossover(df, fast_period=3, slow_period=10, ma_type="sma") is None


def test_insufficient_data_returns_none():
    df = make_df([10.0, 11.0, 12.0])
    assert detect_crossover(df, fast_period=9, slow_period=21, ma_type="ema") is None

def compute_ma(series, period, ma_type="ema"):
    if ma_type == "ema":
        return series.ewm(span=period, adjust=False).mean()
    return series.rolling(window=period).mean()


def detect_crossover(df, fast_period, slow_period, ma_type="ema"):
    """Returns 'bullish_cross', 'bearish_cross', or None for the latest closed candle."""
    if len(df) < slow_period + 2:
        return None

    fast = compute_ma(df["close"], fast_period, ma_type)
    slow = compute_ma(df["close"], slow_period, ma_type)

    prev_diff = fast.iloc[-2] - slow.iloc[-2]
    curr_diff = fast.iloc[-1] - slow.iloc[-1]

    if prev_diff <= 0 and curr_diff > 0:
        return "bullish_cross"
    if prev_diff >= 0 and curr_diff < 0:
        return "bearish_cross"
    return None

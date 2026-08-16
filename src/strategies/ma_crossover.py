NAME = "ma_crossover"
LABEL = "MA Crossover"
PARAMS = {
    "fast_period": {"type": "int", "default": 9, "min": 2, "max": 200, "label": "Fast MA period"},
    "slow_period": {"type": "int", "default": 21, "min": 3, "max": 400, "label": "Slow MA period"},
    "ma_type": {"type": "select", "default": "ema", "options": ["ema", "sma"], "label": "MA type"},
}


def _compute_ma(series, period, ma_type):
    if ma_type == "ema":
        return series.ewm(span=period, adjust=False).mean()
    return series.rolling(window=period).mean()


def detect(df, params):
    """Buy on a fast-MA-crosses-above-slow-MA, sell on the reverse."""
    fast_period = params["fast_period"]
    slow_period = params["slow_period"]
    ma_type = params["ma_type"]

    if len(df) < slow_period + 2:
        return None

    fast = _compute_ma(df["close"], fast_period, ma_type)
    slow = _compute_ma(df["close"], slow_period, ma_type)

    prev_diff = fast.iloc[-2] - slow.iloc[-2]
    curr_diff = fast.iloc[-1] - slow.iloc[-1]

    if prev_diff <= 0 and curr_diff > 0:
        return "buy"
    if prev_diff >= 0 and curr_diff < 0:
        return "sell"
    return None

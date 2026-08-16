NAME = "macd"
LABEL = "MACD Crossover"
PARAMS = {
    "fast_period": {"type": "int", "default": 12, "min": 2, "max": 100, "label": "Fast EMA period"},
    "slow_period": {"type": "int", "default": 26, "min": 3, "max": 200, "label": "Slow EMA period"},
    "signal_period": {"type": "int", "default": 9, "min": 2, "max": 100, "label": "Signal EMA period"},
}


def detect(df, params):
    """Buy when the MACD line crosses above its signal line, sell on the reverse."""
    fast_period = params["fast_period"]
    slow_period = params["slow_period"]
    signal_period = params["signal_period"]

    if len(df) < slow_period + signal_period + 2:
        return None

    fast_ema = df["close"].ewm(span=fast_period, adjust=False).mean()
    slow_ema = df["close"].ewm(span=slow_period, adjust=False).mean()
    macd_line = fast_ema - slow_ema
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()

    prev_diff = macd_line.iloc[-2] - signal_line.iloc[-2]
    curr_diff = macd_line.iloc[-1] - signal_line.iloc[-1]

    if prev_diff <= 0 and curr_diff > 0:
        return "buy"
    if prev_diff >= 0 and curr_diff < 0:
        return "sell"
    return None

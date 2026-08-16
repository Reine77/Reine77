NAME = "bollinger_bands"
LABEL = "Bollinger Bands Touch"
PARAMS = {
    "period": {"type": "int", "default": 20, "min": 5, "max": 200, "label": "Period"},
    "std_dev": {"type": "float", "default": 2.0, "min": 0.5, "max": 5, "label": "Std deviations"},
}


def detect(df, params):
    """Buy the bar price first closes below the lower band, sell the bar it
    first closes above the upper band."""
    period = params["period"]
    std_dev = params["std_dev"]

    if len(df) < period + 2:
        return None

    mid = df["close"].rolling(window=period).mean()
    std = df["close"].rolling(window=period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std

    prev_close, curr_close = df["close"].iloc[-2], df["close"].iloc[-1]
    prev_lower, curr_lower = lower.iloc[-2], lower.iloc[-1]
    prev_upper, curr_upper = upper.iloc[-2], upper.iloc[-1]

    if prev_close >= prev_lower and curr_close < curr_lower:
        return "buy"
    if prev_close <= prev_upper and curr_close > curr_upper:
        return "sell"
    return None

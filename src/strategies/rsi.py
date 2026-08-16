NAME = "rsi"
LABEL = "RSI Oversold/Overbought"
PARAMS = {
    "period": {"type": "int", "default": 14, "min": 2, "max": 100, "label": "RSI period"},
    "oversold": {"type": "int", "default": 30, "min": 1, "max": 49, "label": "Oversold level"},
    "overbought": {"type": "int", "default": 70, "min": 51, "max": 99, "label": "Overbought level"},
}


def _rsi(series, period):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def detect(df, params):
    """Buy when RSI recovers back above the oversold line (bottom), sell when
    it falls back below the overbought line (top)."""
    period = params["period"]
    oversold = params["oversold"]
    overbought = params["overbought"]

    if len(df) < period + 2:
        return None

    rsi = _rsi(df["close"], period)
    prev_rsi, curr_rsi = rsi.iloc[-2], rsi.iloc[-1]

    if prev_rsi < oversold <= curr_rsi:
        return "buy"
    if prev_rsi > overbought >= curr_rsi:
        return "sell"
    return None

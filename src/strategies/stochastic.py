NAME = "stochastic"
LABEL = "Stochastic Oscillator"
PARAMS = {
    "k_period": {"type": "int", "default": 14, "min": 2, "max": 100, "label": "%K period"},
    "d_period": {"type": "int", "default": 3, "min": 1, "max": 20, "label": "%D smoothing"},
    "oversold": {"type": "int", "default": 20, "min": 1, "max": 49, "label": "Oversold level"},
    "overbought": {"type": "int", "default": 80, "min": 51, "max": 99, "label": "Overbought level"},
}


def detect(df, params):
    """Buy when %K crosses above %D while coming out of the oversold zone,
    sell when %K crosses below %D while coming out of the overbought zone."""
    k_period = params["k_period"]
    d_period = params["d_period"]
    oversold = params["oversold"]
    overbought = params["overbought"]

    if len(df) < k_period + d_period + 2:
        return None

    lowest_low = df["low"].rolling(window=k_period).min()
    highest_high = df["high"].rolling(window=k_period).max()
    percent_k = 100 * (df["close"] - lowest_low) / (highest_high - lowest_low)
    percent_d = percent_k.rolling(window=d_period).mean()

    prev_k, curr_k = percent_k.iloc[-2], percent_k.iloc[-1]
    prev_d, curr_d = percent_d.iloc[-2], percent_d.iloc[-1]

    if prev_k <= prev_d and curr_k > curr_d and prev_k < oversold:
        return "buy"
    if prev_k >= prev_d and curr_k < curr_d and prev_k > overbought:
        return "sell"
    return None

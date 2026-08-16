from . import bollinger_bands, ma_crossover, macd, rsi, stochastic

REGISTRY = {
    module.NAME: module
    for module in (ma_crossover, rsi, bollinger_bands, macd, stochastic)
}


def get_strategy(name):
    if name not in REGISTRY:
        raise ValueError(f"Unknown strategy: {name!r}. Available: {sorted(REGISTRY)}")
    return REGISTRY[name]


def resolve_params(name, overrides=None):
    strategy = get_strategy(name)
    params = {key: meta["default"] for key, meta in strategy.PARAMS.items()}
    params.update(overrides or {})
    return params


def detect_signal(name, df, overrides=None):
    strategy = get_strategy(name)
    return strategy.detect(df, resolve_params(name, overrides))


def describe_params(name, overrides=None):
    params = resolve_params(name, overrides)
    return ", ".join(f"{key}={value}" for key, value in params.items())

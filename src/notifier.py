import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, ContextTypes

logger = logging.getLogger(__name__)

SPOT_LABELS = {"buy": "BUY", "sell": "SELL"}
SWAP_LABELS = {"buy": "OPEN LONG", "sell": "OPEN SHORT"}


class TelegramNotifier:
    """Sends MA-crossover signals to a Telegram chat with Confirm/Skip buttons.
    on_confirm(symbol, side, price) is awaited only when the user taps Confirm."""

    def __init__(self, config, on_confirm):
        self.config = config
        self.on_confirm = on_confirm
        self.side_labels = SWAP_LABELS if config.market_type == "swap" else SPOT_LABELS
        self.app = Application.builder().token(config.telegram_bot_token).build()
        self.app.add_handler(CallbackQueryHandler(self._handle_callback))
        self._pending = {}
        self._next_id = 0

    def _register(self, symbol, side, price):
        self._next_id += 1
        signal_id = str(self._next_id)
        self._pending[signal_id] = {"symbol": symbol, "side": side, "price": price}
        return signal_id

    async def send_signal(self, symbol, side, price):
        signal_id = self._register(symbol, side, price)
        label = self.side_labels[side]
        leverage_line = (
            f"Leverage: {self.config.leverage}x ({self.config.margin_mode})\n" if self.config.market_type == "swap" else ""
        )
        text = (
            f"*{label} signal*: {symbol}\n"
            f"{leverage_line}"
            f"Price: {price:.6f} {self.config.quote_currency}\n"
            f"MA crossover ({self.config.fast_ma}/{self.config.slow_ma} {self.config.ma_type.upper()}, "
            f"{self.config.timeframe}) detected."
        )
        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(f"Confirm {label}", callback_data=f"confirm:{signal_id}"),
                    InlineKeyboardButton("Skip", callback_data=f"skip:{signal_id}"),
                ]
            ]
        )
        await self.app.bot.send_message(
            chat_id=self.config.telegram_chat_id,
            text=text,
            parse_mode="Markdown",
            reply_markup=keyboard,
        )

    async def _handle_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        query = update.callback_query
        await query.answer()
        action, signal_id = query.data.split(":", 1)
        signal = self._pending.pop(signal_id, None)

        if signal is None:
            await query.edit_message_text(f"{query.message.text}\n\n(expired, no longer actionable)")
            return

        if action == "confirm":
            result = await self.on_confirm(signal["symbol"], signal["side"], signal["price"])
            suffix = "executed (dry run)" if result.get("dry_run") else "executed"
            await query.edit_message_text(f"{query.message.text}\n\nTrade {suffix}.")
        else:
            await query.edit_message_text(f"{query.message.text}\n\nSkipped.")

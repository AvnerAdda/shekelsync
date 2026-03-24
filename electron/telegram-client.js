const TELEGRAM_API_BASE = 'https://api.telegram.org';

function normalizeTelegramError(payload, fallbackMessage) {
  const description =
    typeof payload?.description === 'string' && payload.description.trim().length > 0
      ? payload.description.trim()
      : fallbackMessage;
  const error = new Error(description);
  if (payload?.error_code) {
    error.code = payload.error_code;
  }
  return error;
}

function createTelegramClient({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Telegram bot token is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const normalizedToken = token.trim();

  async function request(method, body) {
    const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${normalizedToken}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Telegram ${method} returned invalid JSON`);
    }

    if (!response.ok || !payload?.ok) {
      throw normalizeTelegramError(payload, `Telegram ${method} request failed`);
    }

    return payload.result;
  }

  return {
    getMe() {
      return request('getMe', {});
    },
    getUpdates({ offset, timeout = 25, limit = 20 } = {}) {
      const body = {
        timeout,
        limit,
        allowed_updates: ['message'],
      };
      if (typeof offset === 'number' && Number.isFinite(offset)) {
        body.offset = offset;
      }
      return request('getUpdates', body);
    },
    sendMessage(chatId, text, options = {}) {
      if (chatId === undefined || chatId === null || chatId === '') {
        throw new Error('Telegram chat ID is required');
      }
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Telegram message text is required');
      }
      return request('sendMessage', {
        chat_id: chatId,
        text,
        disable_notification: Boolean(options.disableNotification),
      });
    },
  };
}

module.exports = {
  createTelegramClient,
};

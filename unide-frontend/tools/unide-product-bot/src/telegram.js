import fs from 'node:fs';
import path from 'node:path';

export class TelegramClient {
  constructor(token) {
    if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
  }

  async getUpdates({ offset, timeout }) {
    const params = new URLSearchParams();
    if (offset) params.set('offset', String(offset));
    params.set('timeout', String(timeout ?? 25));
    const response = await fetch(`${this.baseUrl}/getUpdates?${params}`);
    return unwrap(await response.json());
  }

  async getFile(fileId) {
    const params = new URLSearchParams({ file_id: fileId });
    const response = await fetch(`${this.baseUrl}/getFile?${params}`);
    return unwrap(await response.json());
  }

  async downloadFile(filePath, destinationPath) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const response = await fetch(`${this.fileBaseUrl}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Failed to download Telegram file: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destinationPath, buffer);
    return destinationPath;
  }

  async sendMessage(chatId, text, options = {}) {
    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: truncate(text, 3900),
        disable_web_page_preview: true,
        ...options
      })
    });
    return unwrap(await response.json());
  }

  async sendPhoto(chatId, filePath, caption = '', options = {}) {
    const fields = {
      chat_id: String(chatId),
      caption: truncate(caption, 1000)
    };
    for (const [key, value] of Object.entries(options)) {
      fields[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }

    const body = multipartBody(fields, {
      photo: { path: filePath, contentType: 'image/png' }
    });

    const response = await fetch(`${this.baseUrl}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': body.contentType },
      body: body.buffer
    });
    return unwrap(await response.json());
  }

  async sendDocument(chatId, filePath, caption = '', options = {}) {
    const fields = {
      chat_id: String(chatId),
      caption: truncate(caption, 1000)
    };
    for (const [key, value] of Object.entries(options)) {
      fields[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }

    const body = multipartBody(fields, {
      document: { path: filePath, contentType: 'application/octet-stream' }
    });

    const response = await fetch(`${this.baseUrl}/sendDocument`, {
      method: 'POST',
      headers: { 'content-type': body.contentType },
      body: body.buffer
    });
    return unwrap(await response.json());
  }

  // Actualiza SOLO los botones de un mensaje ya enviado (el recuento de
  // carne los usa para subir la cantidad en el propio botón). Mejor
  // esfuerzo: si Telegram responde "message is not modified" u otro error
  // puntual, no hay que tumbar nada.
  async editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    try {
      const response = await fetch(`${this.baseUrl}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: replyMarkup
        })
      });
      return unwrap(await response.json());
    } catch {
      return null;
    }
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    // Mejor esfuerzo: Telegram caduca los botones a los ~15 s. Si el bot
    // estaba ocupado (p. ej. esperando al navegador) y responde tarde, la
    // API devuelve "query is too old / query ID is invalid". Ese acuse
    // fallido es IRRELEVANTE (la acción del botón se procesa igual), así
    // que aquí nunca se lanza error: antes tumbaba el bucle de sondeo y el
    // bot se quedaba en "polling error" en cadena.
    try {
      const response = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: truncate(text, 180),
          show_alert: false
        })
      });
      return unwrap(await response.json());
    } catch {
      return null;
    }
  }
}

function unwrap(payload) {
  if (payload?.ok) return payload.result;
  throw new Error(payload?.description || JSON.stringify(payload));
}

function truncate(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 20)}\n...`;
}

function multipartBody(fields, files) {
  const boundary = `----unide-product-bot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  for (const [name, file] of Object.entries(files)) {
    const filePath = typeof file === 'string' ? file : file.path;
    const contentType = typeof file === 'string' ? 'image/png' : (file.contentType || 'application/octet-stream');
    const filename = path.basename(filePath);
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
    chunks.push(fs.readFileSync(filePath));
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.concat(chunks)
  };
}

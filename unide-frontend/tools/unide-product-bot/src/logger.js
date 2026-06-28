import fs from 'node:fs';
import path from 'node:path';

export function createLogger(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.log`);

  function write(level, message, extra = {}) {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      ...extra
    });
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    if (level === 'error') {
      console.error(message, extra);
    } else {
      console.log(message);
    }
  }

  return {
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra)
  };
}

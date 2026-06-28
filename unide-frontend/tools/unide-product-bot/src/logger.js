import fs from 'node:fs';
import path from 'node:path';

export function createLogger(logsDir) {
  let file = null;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    file = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.log`);
  } catch (error) {
    console.warn(`Log folder is not writable, continuing without file logs: ${error.message}`);
  }

  function write(level, message, extra = {}) {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      ...extra
    });
    if (file) {
      try {
        fs.appendFileSync(file, `${line}\n`, 'utf8');
      } catch (error) {
        file = null;
        console.warn(`Log file is not writable, continuing without file logs: ${error.message}`);
      }
    }
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

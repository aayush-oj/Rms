import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

type SmtpSocket = net.Socket | tls.TLSSocket;

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  rejectUnauthorized: boolean;
};

type SmtpMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SmtpResponse = {
  code: number;
  raw: string;
};

const RESPONSE_TIMEOUT_MS = 15_000;

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.EMAIL_FROM?.trim();

  if (!host || !user || !password || !from) return null;

  const configuredPort = Number(process.env.SMTP_PORT || 465);
  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }

  return {
    host,
    port: configuredPort,
    secure: envBoolean(process.env.SMTP_SECURE, configuredPort === 465),
    user,
    password,
    from,
    rejectUnauthorized: envBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
  };
}

export function smtpConfigured(): boolean {
  return smtpConfig() !== null;
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function mailboxAddress(value: string): string {
  const cleaned = cleanHeader(value);
  const angleMatch = cleaned.match(/<([^<>]+)>\s*$/);
  const address = (angleMatch?.[1] || cleaned).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new Error('EMAIL_FROM must contain a valid email address');
  }
  return address;
}

function base64Lines(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return encoded.match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodeHeader(value: string): string {
  const cleaned = cleanHeader(value);
  if (/^[\x20-\x7E]*$/.test(cleaned)) return cleaned;
  return `=?UTF-8?B?${Buffer.from(cleaned, 'utf8').toString('base64')}?=`;
}

function buildMimeMessage(config: SmtpConfig, message: SmtpMessage): string {
  const to = mailboxAddress(message.to);
  const fromAddress = mailboxAddress(config.from);
  const boundary = `mihdineos-${crypto.randomBytes(12).toString('hex')}`;
  const messageIdDomain = fromAddress.split('@')[1] || 'localhost';

  return [
    `From: ${cleanHeader(config.from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${messageIdDomain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function readResponse(socket: SmtpSocket): Promise<SmtpResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP response timed out'));
    }, RESPONSE_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('SMTP connection closed unexpectedly'));
    };

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      let finalLine = '';
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (/^\d{3} /.test(lines[index])) {
          finalLine = lines[index];
          break;
        }
      }
      if (!finalLine) return;

      const code = Number(finalLine.slice(0, 3));
      cleanup();
      resolve({ code, raw: buffer.trim() });
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function write(socket: SmtpSocket, data: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(data, 'utf8', error => error ? reject(error) : resolve());
  });
}

function expect(response: SmtpResponse, expectedCodes: number[], action: string): void {
  if (expectedCodes.includes(response.code)) return;
  throw new Error(`SMTP ${action} failed with ${response.code}: ${response.raw.slice(0, 300)}`);
}

async function command(
  socket: SmtpSocket,
  value: string,
  expectedCodes: number[],
  action: string
): Promise<SmtpResponse> {
  const responsePromise = readResponse(socket);
  await write(socket, `${value}\r\n`);
  const response = await responsePromise;
  expect(response, expectedCodes, action);
  return response;
}

async function connectPlain(config: SmtpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.host, port: config.port });
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

async function connectTls(config: SmtpConfig): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: config.rejectUnauthorized,
    });
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once('error', onError);
    socket.once('secureConnect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

async function upgradeToTls(socket: net.Socket, config: SmtpConfig): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: config.host,
      rejectUnauthorized: config.rejectUnauthorized,
    });
    const onError = (error: Error) => {
      secureSocket.destroy();
      reject(error);
    };
    secureSocket.once('error', onError);
    secureSocket.once('secureConnect', () => {
      secureSocket.off('error', onError);
      resolve(secureSocket);
    });
  });
}

async function authenticate(socket: SmtpSocket, config: SmtpConfig): Promise<void> {
  await command(socket, 'AUTH LOGIN', [334], 'authentication start');
  await command(socket, Buffer.from(config.user, 'utf8').toString('base64'), [334], 'username authentication');
  await command(socket, Buffer.from(config.password, 'utf8').toString('base64'), [235], 'password authentication');
}

function dotStuff(message: string): string {
  return message
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map(line => line.startsWith('.') ? `.${line}` : line)
    .join('\r\n');
}

export async function sendSmtpMessage(message: SmtpMessage): Promise<void> {
  const config = smtpConfig();
  if (!config) throw new Error('EMAIL_NOT_CONFIGURED');

  mailboxAddress(message.to);
  const fromAddress = mailboxAddress(config.from);

  let socket: SmtpSocket = config.secure
    ? await connectTls(config)
    : await connectPlain(config);

  try {
    const greeting = await readResponse(socket);
    expect(greeting, [220], 'greeting');

    await command(socket, 'EHLO mihdineos', [250], 'EHLO');

    if (!config.secure) {
      await command(socket, 'STARTTLS', [220], 'STARTTLS');
      socket = await upgradeToTls(socket as net.Socket, config);
      await command(socket, 'EHLO mihdineos', [250], 'EHLO after STARTTLS');
    }

    await authenticate(socket, config);
    await command(socket, `MAIL FROM:<${fromAddress}>`, [250], 'MAIL FROM');
    await command(socket, `RCPT TO:<${mailboxAddress(message.to)}>`, [250, 251], 'RCPT TO');
    await command(socket, 'DATA', [354], 'DATA');

    const responsePromise = readResponse(socket);
    await write(socket, `${dotStuff(buildMimeMessage(config, message))}\r\n.\r\n`);
    const accepted = await responsePromise;
    expect(accepted, [250], 'message delivery');

    await command(socket, 'QUIT', [221], 'QUIT').catch(() => undefined);
  } finally {
    socket.end();
  }
}

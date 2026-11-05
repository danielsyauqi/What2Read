import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const logger = pino({ level: 'silent' });

export async function connect(store) {
  const authDirectory = path.join(store.directory, 'auth');
  fs.mkdirSync(authDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(authDirectory, 0o700);
  let delay = 2_000;
  let stopped = false;

  process.once('SIGINT', () => { stopped = true; process.exit(0); });
  process.once('SIGTERM', () => { stopped = true; process.exit(0); });

  async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
    const socket = makeWASocket({
      auth: state,
      logger,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('chats.upsert', chats => store.discover(chats));
    socket.ev.on('chats.update', chats => store.discover(chats));
    socket.ev.on('contacts.upsert', contacts => store.discover(contacts));
    socket.ev.on('contacts.update', contacts => store.discover(contacts));
    socket.ev.on('messaging-history.set', ({ chats = [], contacts = [], messages = [] }) => {
      store.discover(chats);
      store.discover(contacts);
      for (const message of messages) store.capture(message);
    });
    socket.ev.on('messages.upsert', ({ messages = [] }) => {
      for (const message of messages) {
        store.discover([{ id: message.key?.remoteJid }]);
        store.capture(message);
      }
    });
    socket.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        console.log('Scan this QR code in WhatsApp > Linked devices > Link a device:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        delay = 2_000;
        console.log('Connected. Run `what2read chats` in another terminal, then `what2read select`. Keep this process running for new messages.');
        try {
          const groups = await socket.groupFetchAllParticipating();
          store.discover(Object.values(groups).map(group => ({ id: group.id, name: group.subject })));
        } catch {
          console.error('Could not fetch group names; incoming messages can still discover chats.');
        }
      }
      if (connection !== 'close' || stopped) return;
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        console.error('WhatsApp unlinked this device. Run `what2read connect` to pair again.');
        process.exitCode = 1;
        return;
      }
      console.error(`Connection closed. Reconnecting in ${Math.ceil(delay / 1000)} seconds.`);
      setTimeout(() => {
        start().catch(error => console.error(`Reconnect failed: ${error.message}`));
      }, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  }

  await start();
}

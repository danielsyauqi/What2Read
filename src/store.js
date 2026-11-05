import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_TEXT_LENGTH = 20_000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function jidOf(value) {
  return typeof value === 'string' ? value : value?._serialized || value?.$1 || null;
}

function timestampOf(value) {
  const number = Number(value?.toString?.() ?? value);
  return Number.isFinite(number) && number > 0 ? number : Math.floor(Date.now() / 1000);
}

function messageDetails(message) {
  const content = message?.ephemeralMessage?.message || message || {};
  const variants = [
    ['text', content.conversation],
    ['text', content.extendedTextMessage?.text],
    ['image', content.imageMessage?.caption],
    ['video', content.videoMessage?.caption],
    ['document', content.documentMessage?.caption || content.documentMessage?.fileName],
    ['audio', ''],
  ];
  for (const [kind, text] of variants) {
    const present = kind === 'audio' ? !!content.audioMessage : kind === 'text' ? typeof text === 'string' : !!content[`${kind}Message`];
    if (present) return { kind, text: String(text || '').slice(0, MAX_TEXT_LENGTH) };
  }
  return { kind: 'other', text: '' };
}

export class Store {
  constructor(directory = process.env.WHAT2READ_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'what2read')) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    this.chatFile = path.join(this.directory, 'chats.json');
    this.allowFile = path.join(this.directory, 'allowed.json');
    this.messageFile = path.join(this.directory, 'messages.ndjson');
    this.messages = [];
    this.messageKeys = new Set();
    this.messageSize = -1;
  }

  chats() {
    return readJson(this.chatFile, {});
  }

  allowed() {
    const value = readJson(this.allowFile, []);
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) throw new Error('Invalid allowed.json');
    return new Set(value);
  }

  discover(chats) {
    const current = this.chats();
    let changed = false;
    for (const chat of chats) {
      const id = jidOf(chat?.id);
      if (!id || id === 'status@broadcast') continue;
      const name = String(chat.name || chat.subject || chat.notify || current[id]?.name || id).slice(0, 200);
      const next = { id, name, isGroup: id.endsWith('@g.us') };
      if (JSON.stringify(current[id]) !== JSON.stringify(next)) {
        current[id] = next;
        changed = true;
      }
    }
    if (changed) writeJson(this.chatFile, current);
  }

  select(ids) {
    const known = this.chats();
    const unique = [...new Set(ids)];
    for (const id of unique) {
      if (!known[id]) throw new Error(`Unknown chat: ${id}. Run connect, then chats.`);
    }
    writeJson(this.allowFile, unique);
    return unique;
  }

  refreshMessages() {
    let stat;
    try {
      stat = fs.statSync(this.messageFile);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.size === this.messageSize) return;
    this.messages = [];
    this.messageKeys.clear();
    const lines = fs.readFileSync(this.messageFile, 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let item;
      try { item = JSON.parse(line); } catch { continue; } // Ignore an incomplete final append.
      if (!item.chatId || !item.id || this.messageKeys.has(item.key)) continue;
      this.messages.push(item);
      this.messageKeys.add(item.key);
    }
    this.messageSize = stat.size;
  }

  capture(message) {
    const chatId = jidOf(message?.key?.remoteJid);
    if (!chatId || !this.allowed().has(chatId) || !message?.key?.id) return false;
    this.refreshMessages();
    const sender = jidOf(message.key.participant) || (message.key.fromMe ? 'me' : chatId);
    const key = `${chatId}:${message.key.id}:${sender}`;
    if (this.messageKeys.has(key)) return false;
    const detail = messageDetails(message.message);
    const item = {
      key,
      id: message.key.id,
      chatId,
      sender,
      senderName: String(message.pushName || '').slice(0, 200),
      timestamp: timestampOf(message.messageTimestamp),
      kind: detail.kind,
      text: detail.text,
    };
    fs.appendFileSync(this.messageFile, `${JSON.stringify(item)}\n`, { mode: 0o600 });
    this.messages.push(item);
    this.messageKeys.add(key);
    this.messageSize = fs.statSync(this.messageFile).size;
    return true;
  }

  selectedChats() {
    const known = this.chats();
    return [...this.allowed()].map(id => known[id]).filter(Boolean);
  }

  read(chatId, { limit = 50, before } = {}) {
    if (!this.allowed().has(chatId)) throw new Error('Chat is not selected');
    this.refreshMessages();
    const rows = this.messages.filter(item => item.chatId === chatId && (!before || item.timestamp < before));
    return rows.sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  }

  search(query, { chatId, limit = 50 } = {}) {
    if (chatId && !this.allowed().has(chatId)) throw new Error('Chat is not selected');
    this.refreshMessages();
    const allowed = this.allowed();
    const needle = query.toLocaleLowerCase();
    return this.messages.filter(item => allowed.has(item.chatId) && (!chatId || item.chatId === chatId) && item.text.toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }
}

#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Store } from './store.js';

process.umask(0o077);

const usage = `What2Read — locally scoped WhatsApp reader for Codex

Usage:
  what2read connect         Pair WhatsApp and capture messages from selected chats
  what2read chats           List discovered chats and their selection status
  what2read select          Choose allowed chats interactively
  what2read allow <chat-id> Add one discovered chat to the allowed set
  what2read deny <chat-id>  Remove one chat from the allowed set
  what2read mcp             Run the read-only MCP server over stdio

Data directory: WHAT2READ_DATA_DIR, or ~/.local/share/what2read`;

function orderedChats(store) {
  return Object.values(store.chats()).sort((a, b) => Number(b.isGroup) - Number(a.isGroup) || a.name.localeCompare(b.name));
}

async function select(store) {
  if (!process.stdin.isTTY) throw new Error('Interactive selection requires a terminal. Use `allow <chat-id>` or `deny <chat-id>` instead.');
  const chats = orderedChats(store);
  if (!chats.length) {
    console.log('No chats discovered yet. Start `what2read connect` first.');
    return;
  }
  const allowed = store.allowed();
  chats.forEach((chat, index) => console.log(`${String(index + 1).padStart(3)} ${allowed.has(chat.id) ? '[x]' : '[ ]'} ${chat.isGroup ? 'Group' : 'Chat '}  ${chat.name} (${chat.id})`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Enter numbers to allow, comma-separated; "none" clears; Enter keeps current: ')).trim();
    if (!answer) return;
    if (answer.toLowerCase() === 'none') {
      store.select([]);
      console.log('No chats selected.');
      return;
    }
    const numbers = answer.split(',').map(value => Number(value.trim()));
    if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > chats.length)) throw new Error('Invalid selection. Use numbers shown in the list.');
    const selected = store.select(numbers.map(number => chats[number - 1].id));
    console.log(`Selected ${selected.length} chat(s).`);
  } finally {
    rl.close();
  }
}

async function main() {
  const [command, id] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(usage);
    return;
  }
  const store = new Store();
  switch (command) {
    case 'connect': {
      const { connect } = await import('./connection.js');
      await connect(store);
      break;
    }
    case 'chats': {
      const allowed = store.allowed();
      const chats = orderedChats(store);
      if (!chats.length) console.log('No chats discovered yet. Start `what2read connect` first.');
      for (const chat of chats) console.log(`${allowed.has(chat.id) ? '[x]' : '[ ]'} ${chat.isGroup ? 'Group' : 'Chat '}  ${chat.name} (${chat.id})`);
      break;
    }
    case 'select':
      await select(store);
      break;
    case 'allow':
      if (!id) throw new Error('Usage: what2read allow <chat-id>');
      store.select([...store.allowed(), id]);
      console.log(`Allowed ${id}`);
      break;
    case 'deny':
      if (!id) throw new Error('Usage: what2read deny <chat-id>');
      store.select([...store.allowed()].filter(value => value !== id));
      console.log(`Removed ${id}`);
      break;
    case 'mcp': {
      const { serve } = await import('./mcp.js');
      await serve(store);
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

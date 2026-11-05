import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('stdio MCP exposes only selected chats and their messages', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'what2read-mcp-'));
  const store = new Store(directory);
  store.discover([{ id: 'uat@g.us', subject: 'Client UAT' }, { id: 'other@g.us', subject: 'Other' }]);
  store.select(['uat@g.us']);
  store.capture({ key: { id: '1', remoteJid: 'uat@g.us' }, messageTimestamp: 100, message: { conversation: 'MOT bill issue' } });
  const child = spawn(process.execPath, [path.join(root, 'src/cli.js'), 'mcp'], {
    cwd: root,
    env: { ...process.env, WHAT2READ_DATA_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let nextId = 0;
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      if (pending.has(response.id)) {
        pending.get(response.id)(response);
        pending.delete(response.id);
      }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}; ${stderr}`)), 5_000);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'what2read-test', version: '1.0.0' },
    });
    assert.equal(init.result?.serverInfo?.name, 'what2read');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = await request('tools/list');
    assert.deepEqual(tools.result.tools.map(item => item.name).sort(), ['read_messages', 'search_messages', 'selected_chats']);
    const selected = await request('tools/call', { name: 'selected_chats', arguments: {} });
    assert.deepEqual(JSON.parse(selected.result.content[0].text).map(chat => chat.id), ['uat@g.us']);
    const search = await request('tools/call', { name: 'search_messages', arguments: { query: 'MOT' } });
    assert.equal(JSON.parse(search.result.content[0].text).length, 1);
    const denied = await request('tools/call', { name: 'read_messages', arguments: { chatId: 'other@g.us' } });
    assert.equal(denied.result.isError, true);
  } finally {
    child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

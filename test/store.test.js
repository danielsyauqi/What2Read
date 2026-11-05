import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { Store } from '../src/store.js';

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'what2read-test-'));
  directories.push(directory);
  const store = new Store(directory);
  store.discover([
    { id: 'uat@g.us', subject: 'Client UAT' },
    { id: 'private@s.whatsapp.net', name: 'Private' },
  ]);
  return store;
}

function message(id, chatId, text, timestamp = 1_000) {
  return {
    key: { id, remoteJid: chatId, participant: 'person@s.whatsapp.net' },
    pushName: 'Client',
    messageTimestamp: timestamp,
    message: { conversation: text },
  };
}

test('only selected chats are captured, readable and searchable', () => {
  const store = fixture();
  store.select(['uat@g.us']);
  assert.equal(store.capture(message('a', 'uat@g.us', 'Bill item is wrong')), true);
  assert.equal(store.capture(message('b', 'private@s.whatsapp.net', 'private issue')), false);
  assert.equal(store.capture(message('a', 'uat@g.us', 'Bill item is wrong')), false);
  assert.equal(store.read('uat@g.us').length, 1);
  assert.equal(store.search('bill').length, 1);
  assert.equal(store.search('private').length, 0);
  assert.throws(() => store.read('private@s.whatsapp.net'), /not selected/);
  assert.equal(fs.statSync(path.join(store.directory, 'messages.ndjson')).mode & 0o777, 0o600);
});

test('deselecting a chat blocks its existing archive and persistence works', () => {
  const store = fixture();
  store.select(['uat@g.us']);
  store.capture(message('a', 'uat@g.us', 'MOT change'));
  const second = new Store(store.directory);
  assert.equal(second.search('MOT').length, 1);
  store.select([]);
  assert.deepEqual(second.selectedChats(), []);
  assert.equal(second.search('MOT').length, 0);
  assert.throws(() => second.read('uat@g.us'), /not selected/);
  assert.equal(second.capture(message('b', 'uat@g.us', 'New issue')), false);
});

test('a second process sees new messages, pagination and media captions', () => {
  const store = fixture();
  store.select(['uat@g.us']);
  const second = new Store(store.directory);
  assert.deepEqual(second.read('uat@g.us'), []);
  store.capture(message('a', 'uat@g.us', 'Older', 100));
  store.capture({
    key: { id: 'b', remoteJid: 'uat@g.us' },
    messageTimestamp: 200,
    message: { imageMessage: { caption: 'Screenshot of bill' } },
  });
  assert.equal(second.read('uat@g.us').length, 2);
  assert.deepEqual(second.read('uat@g.us', { before: 200 }).map(row => row.text), ['Older']);
  assert.equal(second.search('screenshot')[0].kind, 'image');
});

test('unknown chat cannot be selected', () => {
  const store = fixture();
  assert.throws(() => store.select(['unknown@g.us']), /Unknown chat/);
});

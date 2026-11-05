# What2Read

A small, local WhatsApp reader for Codex. Pair a linked device, choose specific chats or groups in a terminal, then let Codex list, read and search only those chats through MCP.

This is an early, unofficial tool built on [Baileys](https://github.com/WhiskeySockets/Baileys). It is not affiliated with WhatsApp or Meta. WhatsApp may change its linked-device protocol or restrict an account. Use it only for chats you are allowed to access, and review client confidentiality rules before sharing message content with an AI service.

## Requirements

- Node.js 24 or newer
- A WhatsApp account that can link a desktop device
- Codex with a local stdio MCP configuration

## Set up

```sh
cd /Users/syauqi/Code/What2Read
npm ci
npm link
what2read connect
```

`connect` prints a QR code. On your phone, open **WhatsApp → Linked devices → Link a device** and scan it. Leave `connect` running to capture new messages. In a second terminal:

```sh
what2read chats
what2read select
```

`select` shows numbered discovered chats. Enter the numbers to permit, separated by commas. The new selection replaces the old one; `none` clears it. You can also use `what2read allow <chat-id>` or `what2read deny <chat-id>`. A chat must first appear in `chats` before you can allow it. Groups are fetched after pairing; other chats appear as WhatsApp syncs them or new messages arrive.

Only messages received or synced **after a chat is selected** are saved. Pairing and chat discovery alone do not save messages. To keep receiving new messages, leave `connect` running (for example in a terminal or a local process manager). The MCP process can read the local archive even when `connect` is stopped.

## Connect Codex

Add this to your local Codex MCP configuration (usually `~/.codex/config.toml`). Replace the project path with your actual path:

```toml
[mcp_servers.what2read]
command = "node"
args = ["/Users/syauqi/Code/What2Read/src/cli.js", "mcp"]
```

Restart Codex so it loads the server. Then ask, for example: “List my selected WhatsApp chats,” or “Search my selected UAT group for reports about bill categories.” The MCP server offers `selected_chats`, `read_messages`, and `search_messages`.

The MCP server only opens local data files. It never opens a WhatsApp connection, and it has no send or mark-as-read tools. The separate `connect` process uses an unofficial linked-device protocol, so its underlying network behaviour cannot be guaranteed to be completely passive.

## Privacy and limits

- Everything is stored locally, unencrypted, under `~/.local/share/what2read` by default. Set `WHAT2READ_DATA_DIR` to use a different location. The auth directory and data files should stay private; do not add them to a repository or backup them into a public location.
- Chat names/IDs are discovered locally, but message text is archived only for selected chats. Deselecting a chat immediately removes its messages from MCP results, though its old local archive remains on disk. To erase old archived data, stop both processes and delete the data directory.
- Text and captions are stored; images, attachments, voice recordings, reactions and quoted-message context are not downloaded or transcribed. Full historical sync is best effort and may be incomplete. WhatsApp may prevent linked devices from accessing restricted chats.
- The archive is a simple NDJSON file suited to a small UAT group. A large account may need database storage and retention controls in a later version.

## Development

```sh
npm run check
```

The tests use synthetic messages and do not connect to WhatsApp.

## License

MIT. See [LICENSE](LICENSE).

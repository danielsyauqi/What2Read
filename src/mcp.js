import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';

function result(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function safely(run) {
  try {
    return result(run());
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
}

export function createServer(store) {
  const server = new McpServer({ name: 'what2read', version: '0.1.0' });
  server.registerTool('selected_chats', {
    description: 'List WhatsApp chats explicitly selected in the local What2Read CLI.',
    inputSchema: z.object({}),
  }, () => safely(() => store.selectedChats()));
  server.registerTool('read_messages', {
    description: 'Read recent locally captured messages from one selected WhatsApp chat. Returns oldest to newest.',
    inputSchema: z.object({
      chatId: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      before: z.number().int().positive().optional(),
    }),
  }, ({ chatId, limit, before }) => safely(() => store.read(chatId, { limit, before })));
  server.registerTool('search_messages', {
    description: 'Search text and captions in locally captured messages from selected WhatsApp chats.',
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      chatId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  }, ({ query, chatId, limit }) => safely(() => store.search(query, { chatId, limit })));
  return server;
}

export async function serve(store) {
  const server = createServer(store);
  await server.connect(new StdioServerTransport());
}

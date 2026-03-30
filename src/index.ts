// Redirect console output to stderr — stdout is reserved for JSON-RPC traffic
console.log = (...args: unknown[]) => process.stderr.write(`[INFO] ${args.join(' ')}\n`);
console.warn = (...args: unknown[]) => process.stderr.write(`[WARN] ${args.join(' ')}\n`);
console.error = (...args: unknown[]) => process.stderr.write(`[ERROR] ${args.join(' ')}\n`);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerRemoteControlTools } from './tools/remote-control.js';
import { registerSourceSearchTools } from './tools/source-search.js';
import { registerLogReaderTools } from './tools/log-reader.js';
import { registerFileWriterTools } from './tools/file-writer.js';
import { getBaseUrl } from './utils/ue5-client.js';

const server = new McpServer({
  name: 'ue5-mcp-server',
  version: '1.0.0',
});

registerRemoteControlTools(server);
registerSourceSearchTools(server);
registerLogReaderTools(server);
registerFileWriterTools(server);

const transport = new StdioServerTransport();

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});

await server.connect(transport);
process.stderr.write(`UE5 MCP Server running on stdio — connected to ${getBaseUrl()}\n`);

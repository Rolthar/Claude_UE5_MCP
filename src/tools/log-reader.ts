import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import { parseLogLines, LogLevel } from '../utils/log-parser.js';

const DEFAULT_TAIL_BYTES = 512_000; // 500 KB — avoids loading multi-GB log files

function errorContent(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

async function tailFile(filePath: string, tailBytes: number): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const fileSize = stat.size;

    if (fileSize === 0) return '';

    const readBytes = Math.min(tailBytes, fileSize);
    const offset = fileSize - readBytes;
    const buffer = Buffer.alloc(readBytes);
    await handle.read(buffer, 0, readBytes, offset);

    let text = buffer.toString('utf-8');

    // If we didn't start at the beginning, discard the first (potentially partial) line
    if (offset > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }

    return text;
  } finally {
    await handle.close();
  }
}

export function registerLogReaderTools(server: McpServer): void {
  // ── ue5_read_log ─────────────────────────────────────────────────────────
  server.tool(
    'ue5_read_log',
    'Read recent lines from the UE5 output log. ' +
      'Optionally filter to only Error or Warning severity. ' +
      'Reads from the tail of the file to avoid loading multi-GB logs.',
    {
      filter: z
        .enum(['All', 'Error', 'Warning', 'Display'])
        .optional()
        .describe('Severity filter: All, Error, Warning, or Display (default: All)'),
      maxLines: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Maximum number of log lines to return (default: 100)'),
      tailBytes: z
        .number()
        .int()
        .min(1)
        .max(10_485_760)
        .optional()
        .describe('Bytes to read from the end of the log file (default: 512000 = 500 KB)'),
    },
    async ({ filter = 'All', maxLines = 100, tailBytes = DEFAULT_TAIL_BYTES }) => {
      const logPath = process.env.UE5_LOG_PATH;
      if (!logPath) {
        return errorContent('UE5_LOG_PATH environment variable is not set.');
      }

      try {
        await fs.promises.access(logPath, fs.constants.R_OK);
      } catch {
        return errorContent(`Log file not found or not readable: ${logPath}`);
      }

      let content: string;
      try {
        content = await tailFile(logPath, tailBytes);
      } catch (err) {
        return errorContent(`Failed to read log file: ${(err as Error).message}`);
      }

      const entries = parseLogLines(content, filter as LogLevel, maxLines);

      if (entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No log entries found matching filter "${filter}" in the last ${tailBytes} bytes.`,
            },
          ],
        };
      }

      const formatted = entries
        .map((e) => {
          const lvl = e.level !== 'Unknown' ? `[${e.level}]` : '';
          const cat = e.category ? `${e.category}: ` : '';
          return `${lvl} ${cat}${e.message}`.trim();
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Showing ${entries.length} log line(s) (filter: ${filter}):\n\n${formatted}`,
          },
        ],
      };
    },
  );
}

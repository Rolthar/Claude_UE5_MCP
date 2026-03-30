import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { glob } from 'glob';
import fs from 'fs';
import { resolveWithinDir } from '../utils/path-guard.js';

function errorContent(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

function getSourceDir(): string | null {
  return process.env.UE5_PROJECT_SOURCE ?? null;
}

export function registerSourceSearchTools(server: McpServer): void {
  // ── ue5_search_source ────────────────────────────────────────────────────
  server.tool(
    'ue5_search_source',
    'Search C++ and header files in the UE5 project Source directory using a regex pattern. ' +
      'Returns file path, line number, and surrounding context for each match.',
    {
      pattern: z.string().min(1).describe('Text or regex pattern to search for'),
      fileGlob: z
        .string()
        .optional()
        .describe('Glob pattern relative to Source dir (default: **/*.{cpp,h})'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of matches to return (default: 50)'),
      contextLines: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe('Lines of context before/after each match (default: 2)'),
    },
    async ({ pattern, fileGlob = '**/*.{cpp,h}', maxResults = 50, contextLines = 2 }) => {
      const sourceDir = getSourceDir();
      if (!sourceDir) {
        return errorContent('UE5_PROJECT_SOURCE environment variable is not set.');
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return errorContent(`Invalid regex pattern: "${pattern}"`);
      }

      const files = await glob(fileGlob, { cwd: sourceDir, absolute: true });
      if (files.length === 0) {
        return errorContent(`No files found matching glob "${fileGlob}" in ${sourceDir}`);
      }

      const output: string[] = [];
      let matchCount = 0;

      outer: for (const file of files) {
        let content: string;
        try {
          content = await fs.promises.readFile(file, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (!regex.test(lines[i])) continue;
          regex.lastIndex = 0; // reset for 'g' flag if present

          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length - 1, i + contextLines);

          // Relative path for cleaner output
          const relPath = file.replace(sourceDir.replace(/\\/g, '/'), '').replace(/^[/\\]/, '');
          output.push(`=== ${relPath}:${i + 1} ===`);
          for (let j = start; j <= end; j++) {
            const prefix = j === i ? '>>' : '  ';
            output.push(`${prefix} ${j + 1}: ${lines[j]}`);
          }
          output.push('');

          matchCount++;
          if (matchCount >= maxResults) break outer;
        }
        regex.lastIndex = 0;
      }

      if (matchCount === 0) {
        return { content: [{ type: 'text', text: `No matches found for pattern: "${pattern}"` }] };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Found ${matchCount} match(es) (limit: ${maxResults}):\n\n${output.join('\n')}`,
          },
        ],
      };
    },
  );

  // ── ue5_read_file ────────────────────────────────────────────────────────
  server.tool(
    'ue5_read_file',
    'Read the contents of a specific C++ source file in the project Source directory. ' +
      'Supports optional line range to limit output for large files.',
    {
      filePath: z
        .string()
        .min(1)
        .describe('Path relative to the Source directory, e.g. "MyGame/GameManager.cpp"'),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('First line to return (1-indexed, inclusive)'),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Last line to return (1-indexed, inclusive)'),
    },
    async ({ filePath, startLine, endLine }) => {
      const sourceDir = getSourceDir();
      if (!sourceDir) {
        return errorContent('UE5_PROJECT_SOURCE environment variable is not set.');
      }

      let absPath: string;
      try {
        absPath = resolveWithinDir(filePath, sourceDir);
      } catch (err) {
        return errorContent((err as Error).message);
      }

      let content: string;
      try {
        content = await fs.promises.readFile(absPath, 'utf-8');
      } catch {
        return errorContent(`File not found: ${filePath}`);
      }

      const lines = content.split('\n');
      const from = startLine ? startLine - 1 : 0;
      const to = endLine ? endLine : lines.length;
      const slice = lines.slice(from, to);

      const numbered = slice
        .map((line, i) => `${from + i + 1}: ${line}`)
        .join('\n');

      return { content: [{ type: 'text', text: numbered }] };
    },
  );
}

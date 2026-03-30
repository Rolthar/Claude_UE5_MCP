import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { resolveWithinDir } from '../utils/path-guard.js';
import { rcPost } from '../utils/ue5-client.js';

// ── Staging store ────────────────────────────────────────────────────────────

interface StagedFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  stagedAt: number;
}

const stagingMap = new Map<string, StagedFile>();

function getTtlMs(): number {
  const raw = process.env.UE5_STAGING_TTL_MS;
  return raw ? parseInt(raw, 10) : 600_000;
}

function evictExpired(): void {
  const now = Date.now();
  const ttl = getTtlMs();
  for (const [key, entry] of stagingMap) {
    if (now - entry.stagedAt > ttl) {
      stagingMap.delete(key);
    }
  }
}

function getAllowedExtensions(): Set<string> {
  const raw = process.env.UE5_WRITE_EXTENSIONS ?? '.cpp,.h';
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()));
}

function isFileWriteEnabled(): boolean {
  return process.env.UE5_ALLOW_FILE_WRITE === 'true';
}

function getSourceDir(): string | null {
  return process.env.UE5_PROJECT_SOURCE ?? null;
}

function errorContent(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

function auditLog(action: string, details: string): void {
  process.stderr.write(`[AUDIT] ${new Date().toISOString()} ${action}: ${details}\n`);
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerFileWriterTools(server: McpServer): void {
  // ── ue5_stage_files ──────────────────────────────────────────────────────
  server.tool(
    'ue5_stage_files',
    'Stage one or more C++ files in memory for review before writing to disk. ' +
      'Nothing is written until ue5_commit_files is called. ' +
      'Requires UE5_ALLOW_FILE_WRITE=true. Only .cpp and .h files are permitted.',
    {
      files: z
        .array(
          z.object({
            path: z
              .string()
              .min(1)
              .describe('File path relative to the Source directory, e.g. "MyGame/MyActor.h"'),
            content: z.string().describe('Full file content to write'),
          }),
        )
        .min(1)
        .max(20)
        .describe('Array of files to stage'),
      allowOverwrite: z
        .boolean()
        .optional()
        .describe(
          'If false (default), reject files that already exist on disk. Set true to allow overwriting.',
        ),
    },
    async ({ files, allowOverwrite = false }) => {
      if (!isFileWriteEnabled()) {
        return errorContent(
          'File write tools are disabled. Set UE5_ALLOW_FILE_WRITE=true to enable.',
        );
      }

      const sourceDir = getSourceDir();
      if (!sourceDir) {
        return errorContent('UE5_PROJECT_SOURCE environment variable is not set.');
      }

      evictExpired();

      const allowedExts = getAllowedExtensions();
      const staged: string[] = [];
      const conflicts: string[] = [];
      const rejected: string[] = [];

      for (const file of files) {
        // Extension check
        const ext = path.extname(file.path).toLowerCase();
        if (!allowedExts.has(ext)) {
          rejected.push(`${file.path} (extension "${ext}" not in whitelist: ${[...allowedExts].join(', ')})`);
          continue;
        }

        // Path jail check
        let absPath: string;
        try {
          absPath = resolveWithinDir(file.path, sourceDir);
        } catch (err) {
          rejected.push(`${file.path}: ${(err as Error).message}`);
          continue;
        }

        // Overwrite check
        if (!allowOverwrite && fs.existsSync(absPath)) {
          conflicts.push(file.path);
          continue;
        }

        stagingMap.set(absPath, {
          absolutePath: absPath,
          relativePath: file.path,
          content: file.content,
          stagedAt: Date.now(),
        });
        staged.push(file.path);
      }

      const expiry = new Date(Date.now() + getTtlMs()).toISOString();
      const lines: string[] = [];

      if (staged.length > 0) {
        lines.push(`Staged ${staged.length} file(s) (expires ${expiry}):`);
        staged.forEach((p) => lines.push(`  + ${p}`));
        lines.push('');
        lines.push('Call ue5_preview_staged to review contents, then ue5_commit_files to write.');
      }
      if (conflicts.length > 0) {
        lines.push(`Skipped ${conflicts.length} file(s) — already exist on disk (set allowOverwrite: true to overwrite):`);
        conflicts.forEach((p) => lines.push(`  ! ${p}`));
      }
      if (rejected.length > 0) {
        lines.push(`Rejected ${rejected.length} file(s):`);
        rejected.forEach((p) => lines.push(`  x ${p}`));
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // ── ue5_preview_staged ───────────────────────────────────────────────────
  server.tool(
    'ue5_preview_staged',
    'Preview the full content of all staged files before committing to disk. ' +
      'This is the review gate — inspect output before calling ue5_commit_files.',
    {
      filePath: z
        .string()
        .optional()
        .describe(
          'If provided, show only this specific file (relative path). Otherwise shows all staged files.',
        ),
    },
    async ({ filePath }) => {
      evictExpired();

      if (stagingMap.size === 0) {
        return { content: [{ type: 'text', text: 'No files currently staged.' }] };
      }

      const entries = filePath
        ? [...stagingMap.values()].filter((e) => e.relativePath === filePath)
        : [...stagingMap.values()];

      if (entries.length === 0) {
        return errorContent(`No staged file found with path: "${filePath}"`);
      }

      const output = entries
        .map((e) => {
          const age = Math.round((Date.now() - e.stagedAt) / 1000);
          return `=== ${e.relativePath} (staged ${age}s ago) ===\n${e.content}`;
        })
        .join('\n\n');

      return { content: [{ type: 'text', text: output }] };
    },
  );

  // ── ue5_commit_files ─────────────────────────────────────────────────────
  server.tool(
    'ue5_commit_files',
    'Write all staged files (or a subset) to disk. ' +
      'Directories are created if needed. Optionally triggers a hot reload compile afterwards. ' +
      'Requires UE5_ALLOW_FILE_WRITE=true.',
    {
      paths: z
        .array(z.string())
        .optional()
        .describe(
          'Relative paths of specific staged files to commit. If omitted, commits all staged files.',
        ),
      triggerCompile: z
        .boolean()
        .optional()
        .describe(
          'If true, sends a hot reload request via the Remote Control API after writing (default: false)',
        ),
    },
    async ({ paths, triggerCompile = false }) => {
      // Defense in depth — re-check even though stage already checked
      if (!isFileWriteEnabled()) {
        return errorContent(
          'File write tools are disabled. Set UE5_ALLOW_FILE_WRITE=true to enable.',
        );
      }

      evictExpired();

      if (stagingMap.size === 0) {
        return errorContent('No staged files to commit. Call ue5_stage_files first.');
      }

      // Determine which entries to commit
      let toCommit: StagedFile[];
      if (paths && paths.length > 0) {
        toCommit = paths.map((p) => {
          const found = [...stagingMap.values()].find((e) => e.relativePath === p);
          if (!found) throw new Error(`No staged file with path: "${p}"`);
          return found;
        });
      } else {
        toCommit = [...stagingMap.values()];
      }

      const written: string[] = [];
      const errors: string[] = [];

      for (const entry of toCommit) {
        try {
          await fs.promises.mkdir(path.dirname(entry.absolutePath), { recursive: true });
          await fs.promises.writeFile(entry.absolutePath, entry.content, 'utf-8');
          stagingMap.delete(entry.absolutePath);
          written.push(entry.relativePath);
          auditLog('COMMIT', entry.absolutePath);
        } catch (err) {
          errors.push(`${entry.relativePath}: ${(err as Error).message}`);
          auditLog('COMMIT_ERROR', `${entry.absolutePath} — ${(err as Error).message}`);
        }
      }

      const lines: string[] = [];
      if (written.length > 0) {
        lines.push(`Written ${written.length} file(s):`);
        written.forEach((p) => lines.push(`  ✓ ${p}`));
      }
      if (errors.length > 0) {
        lines.push(`Failed ${errors.length} file(s):`);
        errors.forEach((e) => lines.push(`  ✗ ${e}`));
      }

      // Optional hot reload
      if (triggerCompile && written.length > 0) {
        try {
          await rcPost('/remote/exec', {
            objectPath: '/Script/Engine.Default__KismetSystemLibrary',
            functionName: 'ExecuteConsoleCommand',
            parameters: { Command: 'recompile' },
          });
          lines.push('');
          lines.push('Hot reload triggered. Call ue5_read_log with filter "Error" to check results.');
        } catch (err) {
          lines.push(`Hot reload request failed: ${(err as Error).message}`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}

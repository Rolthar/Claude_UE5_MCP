import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rcPut } from '../utils/ue5-client.js';

// Commands that could cause destructive or unintended side effects
const BLOCKED_PREFIXES = [
  'quit',
  'exit',
  'open ',
  'cmd ',
  'cmd/',
  'exec ',
  'start ',
  'shell',
  'servertravel',
  'disconnect',
];

function assertCommandAllowed(command: string): void {
  const lower = command.toLowerCase().trim();
  for (const prefix of BLOCKED_PREFIXES) {
    if (lower === prefix.trimEnd() || lower.startsWith(prefix)) {
      throw new Error(
        `Console command blocked for safety: "${command}". ` +
          `Blocked prefixes: ${BLOCKED_PREFIXES.map((p) => `"${p.trim()}"`).join(', ')}`,
      );
    }
  }
}

function errorContent(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

export function registerRemoteControlTools(server: McpServer): void {
  // ── ue5_run_console_command ──────────────────────────────────────────────
  server.tool(
    'ue5_run_console_command',
    'Execute a console command in the running UE5 editor session. ' +
      'Use for stat commands, CVars, level operations, actor spawning, etc. ' +
      'Destructive commands (quit, open, exit) are blocked.',
    { command: z.string().min(1).describe('The console command string, e.g. "stat fps"') },
    async ({ command }) => {
      try {
        assertCommandAllowed(command);
        const result = await rcPut('/remote/object/call', {
          objectPath: '/Script/Engine.Default__KismetSystemLibrary',
          functionName: 'ExecuteConsoleCommand',
          parameters: { Command: command },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  // ── ue5_get_object_property ──────────────────────────────────────────────
  server.tool(
    'ue5_get_object_property',
    'Read a property value from any UObject in the current level by its full Unreal object path.',
    {
      objectPath: z
        .string()
        .min(1)
        .describe(
          'Full Unreal object path, e.g. "/Game/Maps/TestMap.TestMap:PersistentLevel.PointLight_0"',
        ),
      propertyName: z
        .string()
        .min(1)
        .describe('Property name as it appears in C++ or the Details panel'),
    },
    async ({ objectPath, propertyName }) => {
      try {
        const result = await rcPut('/remote/object/property', {
          objectPath,
          access: 'READ_ACCESS',
          propertyName,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  // ── ue5_set_object_property ──────────────────────────────────────────────
  server.tool(
    'ue5_set_object_property',
    'Set a property value on any UObject in the current level. ' +
      'The value must match the expected JSON type for the property.',
    {
      objectPath: z.string().min(1).describe('Full Unreal object path'),
      propertyName: z.string().min(1).describe('Property name to set'),
      propertyValue: z
        .unknown()
        .describe('JSON-serialisable value matching the property type'),
    },
    async ({ objectPath, propertyName, propertyValue }) => {
      try {
        const result = await rcPut('/remote/object/property', {
          objectPath,
          access: 'WRITE_ACCESS',
          propertyName,
          propertyValue: { [propertyName]: propertyValue },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );

  // ── ue5_call_function ────────────────────────────────────────────────────
  server.tool(
    'ue5_call_function',
    'Call a Blueprint-callable UFUNCTION on any actor or component by its full Unreal object path.',
    {
      objectPath: z.string().min(1).describe('Full Unreal object path'),
      functionName: z.string().min(1).describe('Exact name of the UFUNCTION to call'),
      parameters: z
        .record(z.unknown())
        .optional()
        .describe('Key/value pairs matching function parameter names'),
    },
    async ({ objectPath, functionName, parameters }) => {
      try {
        const result = await rcPut('/remote/object/call', {
          objectPath,
          functionName,
          parameters: parameters ?? {},
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return errorContent((err as Error).message);
      }
    },
  );
}

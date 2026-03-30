export type LogLevel = 'Error' | 'Warning' | 'Display' | 'All';

export interface LogEntry {
  raw: string;
  level: 'Error' | 'Warning' | 'Display' | 'Unknown';
  category?: string;
  message: string;
  lineNumber: number;
}

// Matches UE5 log format: [yyyy.mm.dd-HH:MM:SS:mmm][NNN]LogCategory: (Error:|Warning:)? Message
const LOG_LINE_RE = /^\[[\d.\-:]+\]\[\s*\d+\](\w+):\s*(Error:|Warning:|Display:)?\s*(.*)$/;

function classifyLevel(prefix: string | undefined): LogEntry['level'] {
  if (!prefix) return 'Display';
  const p = prefix.toLowerCase();
  if (p.startsWith('error')) return 'Error';
  if (p.startsWith('warning')) return 'Warning';
  if (p.startsWith('display')) return 'Display';
  return 'Unknown';
}

/**
 * Parses UE5 log content into structured entries, optionally filtered by level.
 * Reads from the end of the content to return the most recent `maxLines` matching entries.
 */
export function parseLogLines(
  content: string,
  filter: LogLevel,
  maxLines: number,
): LogEntry[] {
  // Strip UTF-8 BOM if present
  const cleaned = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const lines = cleaned.split('\n');

  const results: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const match = LOG_LINE_RE.exec(raw);
    const level = match ? classifyLevel(match[2]) : 'Unknown';
    const category = match ? match[1] : undefined;
    const message = match ? match[3] : raw;

    // Apply filter
    if (filter !== 'All' && level !== filter) continue;

    results.push({ raw, level, category, message, lineNumber: i + 1 });

    // Keep only the last maxLines matches (sliding window)
    if (results.length > maxLines) {
      results.shift();
    }
  }

  return results;
}

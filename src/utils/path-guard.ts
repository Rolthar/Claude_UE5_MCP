import path from 'path';

/**
 * Resolves filePath relative to baseDir and validates it stays within baseDir.
 * Throws if the resolved path escapes the base directory (path traversal attack).
 * Returns the absolute resolved path on success.
 */
export function resolveWithinDir(filePath: string, baseDir: string): string {
  // Fast pre-check for obvious traversal sequences
  if (filePath.includes('..')) {
    throw new Error(`Path traversal rejected: "${filePath}" contains ".."`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, filePath);

  // Ensure target is inside base (add sep to prevent prefix-match attacks, e.g. /foo vs /foobar)
  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    throw new Error(`Path traversal rejected: "${filePath}" escapes source directory`);
  }

  return resolvedTarget;
}

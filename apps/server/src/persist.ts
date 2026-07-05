import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write a file atomically: serialize to a sibling temp file on the SAME
 * filesystem, then rename it over the target. rename(2) is atomic on POSIX, so a
 * concurrent reader — or the next boot — sees either the old complete file or the
 * new complete file, never a half-written or zero-length one.
 *
 * A plain writeFileSync opens the target with O_TRUNC, truncating it to zero
 * BEFORE the new bytes land. An interrupted write (SIGKILL on deploy/OOM, or
 * ENOSPC on a full disk) then leaves the store corrupt — which for the user
 * store silently wipes every account and re-opens admin bootstrap. This closes
 * that window for every *_FILE store.
 */
export function writeFileAtomic(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (err) {
    // Never leave a partial temp file lying around on failure.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore cleanup failure */
    }
    throw err;
  }
}

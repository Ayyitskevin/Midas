import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
    // Owner-only from creation. These stores hold secrets (encrypted exchange
    // keys, password hashes); a default-umask temp would be briefly (and, on
    // first creation, permanently) world-readable.
    writeFileSync(tmp, data, { mode: 0o600 });
    // Preserve the target's existing permission bits if it already exists — an
    // operator may have widened a non-secret store, or tightened a secret one.
    try {
      chmodSync(tmp, statSync(file).mode);
    } catch {
      /* target doesn't exist yet — the temp keeps its owner-only 0o600 */
    }
    // fsync the temp's bytes to disk BEFORE the rename so a power failure can't
    // leave the renamed store empty/corrupt — the exact outcome the rename is
    // meant to prevent. Then fsync the directory so the rename itself is durable.
    const fd = openSync(tmp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
    try {
      const dir = openSync(dirname(file), 'r');
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } catch {
      /* directory fsync is best-effort; the rename already landed */
    }
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

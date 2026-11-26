import type { Dirent } from 'node:fs';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Local sandboxes keep one folder for each session, with a checkout of the
 * repository. Factory does not delete the folder when the session ends, so
 * the disk fills up. This function deletes each session folder that has no
 * file changed in the last `maxIdleDays` days.
 *
 * Call it only before the server starts. A running server keeps the workspace
 * of an active session and does not clone the repository again when its
 * folder is missing. When a session comes back after a restart, Factory sets
 * up its workspace again and clones the repository into a new folder.
 *
 * Changes that the agent did not commit and push are lost with the folder.
 */
export async function removeIdleSessionFolders(root: string, maxIdleDays: number): Promise<void> {
  if (!(maxIdleDays > 0)) return;

  let sessions: Dirent[];
  try {
    sessions = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  const cutoff = Date.now() - maxIdleDays * DAY_MS;
  for (const session of sessions) {
    if (!session.isDirectory()) continue;
    const folder = join(root, session.name);
    if (await changedSince(folder, cutoff)) continue;
    await rm(folder, { recursive: true, force: true });
    console.info(`Session cleanup: deleted ${folder}, because no file in it changed in ${maxIdleDays} days.`);
  }
}

/**
 * Returns true when the path, or a file or folder below it, changed after
 * `cutoff`. It does not look into node_modules and .git/objects, because
 * those folders are large and change only together with other files. When
 * it cannot read a path, it returns true, so that the folder stays.
 */
async function changedSince(path: string, cutoff: number, insideGit = false): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.mtimeMs >= cutoff) return true;
    if (!stats.isDirectory()) return false;

    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      if (insideGit && entry.name === 'objects') continue;
      if (await changedSince(join(path, entry.name), cutoff, insideGit || entry.name === '.git')) return true;
    }
    return false;
  } catch {
    return true;
  }
}

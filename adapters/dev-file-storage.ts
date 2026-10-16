import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Not a real vendor: the stand-in for R2 whenever USE_R2_STORAGE is not
// "true". Files go to .dev-files/ (git-ignored) on this machine.
const DEV_FILES_DIR = path.join(process.cwd(), ".dev-files");

// Keys are built by our own code, but check anyway that one can never point
// outside .dev-files/ (for example with "../").
function devPath(key: string): string {
  const fullPath = path.resolve(DEV_FILES_DIR, key);
  if (!fullPath.startsWith(DEV_FILES_DIR + path.sep)) {
    throw new Error("File key points outside the dev files folder");
  }
  return fullPath;
}

export async function putToDevFiles(key: string, bytes: Buffer): Promise<void> {
  const fullPath = devPath(key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
}

export async function readFromDevFiles(key: string): Promise<Buffer | null> {
  try {
    return await readFile(devPath(key));
  } catch {
    return null;
  }
}

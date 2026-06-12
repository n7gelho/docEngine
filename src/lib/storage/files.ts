import { createHash } from "crypto";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

export async function ensureUploadDir() {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function saveUploadedFile(
  buffer: Buffer,
  originalFilename: string
): Promise<{ storageKey: string; sha256: string }> {
  await ensureUploadDir();
  const sha256 = computeSha256(buffer);
  const ext = path.extname(originalFilename) || "";
  const storageKey = `${sha256}${ext}`;
  const filePath = path.join(UPLOAD_DIR, storageKey);
  await writeFile(filePath, buffer);
  return { storageKey, sha256 };
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  const filePath = path.join(UPLOAD_DIR, storageKey);
  return readFile(filePath);
}

export function getStoredFilePath(storageKey: string): string {
  return path.join(UPLOAD_DIR, storageKey);
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  const filePath = getStoredFilePath(storageKey);
  await unlink(filePath);
}

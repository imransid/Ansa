// Zip checks (step 34, "Add to knowledge" on a .docx): lib/knowledge/
// docx-guard.ts passes a well-made archive and refuses a zip bomb, also the
// ones that hide from a reader that trusts the archive's own numbers. Each
// odd archive below is one JSZip (mammoth's zip reader) would read
// differently from the guard: it takes every directory entry it finds,
// whatever count the end record states; it moves every offset when the
// directory doesn't end where the end record starts; and a disk number of
// 0xffff sends it to zip64 records. Archives are built here, byte by byte.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { isSafeToUnpack } from "@/lib/knowledge/docx-guard";
import { extractDocumentText } from "@/lib/knowledge/extract-text";
import { check } from "./helpers";

const FIXTURES = path.join(process.cwd(), "scripts", "tenant-isolation", "fixtures");
const MB = 1024 * 1024;

// sizeClaimed: what the archive says the file unpacks to (a zip bomb lies).
type FileToZip = { name: string; content: Buffer; stored?: boolean; sizeClaimed?: number };

type ArchiveShape = {
  // The count the end record states, when not the real one.
  countStated?: number;
  // Bytes between the directory and the end record.
  bytesBeforeEndRecord?: number;
  // Bytes before the archive, its offsets not counting them (a self-extractor).
  bytesBeforeArchive?: number;
  // The end record's disk number: 0xffff means "see the zip64 record".
  diskNumber?: number;
  comment?: string;
  // This many more directory entries, all pointing at the first file's bytes.
  sharedEntries?: number;
};

// A zip archive of these files, laid out as the shape says.
function zipArchive(files: FileToZip[], shape: ArchiveShape = {}): Buffer {
  const fileParts: Buffer[] = [];
  const entries: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const packed = file.stored ? file.content : deflateRawSync(file.content);
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.stored ? 0 : 8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.sizeClaimed ?? file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    entries.push(directoryEntry(name, file, packed.length, offset));
    fileParts.push(local, name, packed);
    offset += local.length + name.length + packed.length;
  }
  for (let copy = 0; copy < (shape.sharedEntries ?? 0); copy++) {
    entries.push(Buffer.from(entries[0]));
  }
  const directory = Buffer.concat(entries);
  const comment = Buffer.from(shape.comment ?? "");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(shape.diskNumber ?? 0, 4);
  end.writeUInt16LE(shape.countStated ?? entries.length, 8);
  end.writeUInt16LE(shape.countStated ?? entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([
    Buffer.alloc(shape.bytesBeforeArchive ?? 0, "x"),
    ...fileParts,
    directory,
    Buffer.alloc(shape.bytesBeforeEndRecord ?? 0, "x"),
    end,
    comment,
  ]);
}

function directoryEntry(name: Buffer, file: FileToZip, packedLength: number, localHeaderOffset: number): Buffer {
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(file.stored ? 0 : 8, 10);
  entry.writeUInt32LE(packedLength, 20);
  entry.writeUInt32LE(file.sizeClaimed ?? file.content.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(localHeaderOffset, 42);
  return Buffer.concat([entry, name]);
}

const documentXml = { name: "word/document.xml", content: Buffer.from("<w:document>Refunds take 5 days.</w:document>") };
const smallText = { name: "a.txt", content: Buffer.from("hi"), stored: true };
// 60 MB of zeros packs into about 60 KB. The archive claims 100 bytes.
const bombXml = { name: "word/document.xml", content: Buffer.alloc(60 * MB), sizeClaimed: 100 };

export async function runKnowledgeZipChecks() {
  await check("docx guard: a well-made archive passes (one file, several, stored or packed, with a comment), and so does a real .docx", async () => {
    assert.equal(isSafeToUnpack(zipArchive([documentXml])), true);
    assert.equal(isSafeToUnpack(zipArchive([smallText, documentXml], { comment: "made by hand" })), true);
    // Up to 50 MB unpacked is a document, not a bomb.
    assert.equal(isSafeToUnpack(zipArchive([{ name: "word/document.xml", content: Buffer.alloc(40 * MB) }])), true);
    assert.equal(isSafeToUnpack(await readFile(path.join(FIXTURES, "returns-policy.docx"))), true);
  });

  await check("docx guard: a zip bomb is refused, also one left out of the stated count, behind bytes the offsets don't count, behind a zip64 marker, or in files sharing bytes", async () => {
    const bomb = zipArchive([bombXml]);
    assert.ok(bomb.length < 200_000);
    assert.equal(isSafeToUnpack(bomb), false);
    assert.deepEqual(await extractDocumentText(bomb, "docx"), { ok: false, reason: "unreadable" });
    // The end record counts only a.txt; JSZip would still unpack the bomb after it.
    assert.equal(isSafeToUnpack(zipArchive([smallText, bombXml], { countStated: 1 })), false);
    // A count higher than the entries found is just as odd.
    assert.equal(isSafeToUnpack(zipArchive([documentXml], { countStated: 2 })), false);
    // JSZip would read every offset shifted by these bytes, so somewhere else.
    assert.equal(isSafeToUnpack(zipArchive([documentXml], { bytesBeforeEndRecord: 100 })), false);
    assert.equal(isSafeToUnpack(zipArchive([documentXml], { bytesBeforeArchive: 100 })), false);
    // JSZip would take the directory's place and size from a zip64 record.
    assert.equal(isSafeToUnpack(zipArchive([documentXml], { diskNumber: 0xffff })), false);
    // 100 entries pointing at one 100 KB file: 10 MB unpacked (under the cap),
    // but 10 MB of packed bytes to inflate out of a 100 KB archive.
    const shared = zipArchive([{ name: "word/document.xml", content: randomBytes(100 * 1024) }], { sharedEntries: 99 });
    assert.equal(isSafeToUnpack(shared), false);
    // Bytes after the end record that its comment length doesn't count.
    assert.equal(isSafeToUnpack(Buffer.concat([zipArchive([documentXml]), Buffer.from("trailing")])), false);
  });
}

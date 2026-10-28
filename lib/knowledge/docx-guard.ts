import "server-only";
import { inflateRawSync } from "node:zlib";

// A .docx file is a zip archive. Before mammoth unpacks one (step 34, "Add to
// knowledge"), this unpacks every file in it once with a hard cap, so a
// "zip bomb" (4 MB that unpacks to gigabytes) is refused instead of filling
// the server's memory. The sizes the archive states are not trusted: each
// file is really inflated, and the inflating stops at the cap.
//
// WHY the layout must add up exactly: mammoth's zip reader (JSZip 3) reads
// an archive its own way. It takes every directory entry it finds, whatever
// count the archive states; when the directory doesn't end where the end
// record starts, it moves every offset by the difference; and some numbers
// in the end record send it to zip64 records instead. An archive read one way
// here and another way there would be checked here and unpacked differently
// there. So only an archive that both read the same way passes: no zip64, no
// split archive, the stated count found, the directory ending right at the
// end record, nothing after it, and no two files sharing bytes.

// Far above any real document: a 4 MB .docx of plain text unpacks to about
// 40 MB of XML at most; pictures barely change size.
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_FILES_IN_ARCHIVE = 5_000;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const END_RECORD_SIZE = 22;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const CENTRAL_ENTRY_SIZE = 46;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
// The size fields hold this when the real size is in a zip64 record, which
// no document of 4 MB needs.
const ZIP64_MARKER = 0xffffffff;

type CentralDirectory = { entryCount: number; offset: number; endRecordStart: number };
type ArchivedFile = { method: number; compressedSize: number; localHeaderOffset: number };

// True when the archive can be read and unpacks to at most 50 MB in all.
// Anything odd (not a zip, zip64, an unknown compression, a file running
// past the end, a layout JSZip could read differently) is false: mammoth is
// never handed it.
export function isSafeToUnpack(archive: Buffer): boolean {
  try {
    return unpackedSize(archive) <= MAX_UNPACKED_BYTES;
  } catch {
    return false;
  }
}

// Inflates every file of the archive and adds up their real sizes. Throws
// for anything odd, or once the total passes the cap (inflateRawSync's
// maxOutputLength).
function unpackedSize(archive: Buffer): number {
  const files = readCentralDirectory(archive, findEndRecord(archive));
  let packedTotal = 0;
  let total = 0;
  for (const file of files) {
    // Real files never share bytes. Many entries pointing at the same packed
    // bytes would make this inflate them over and over.
    packedTotal += file.compressedSize;
    if (packedTotal > archive.length) {
      throw new Error("Files share bytes");
    }
    const data = fileData(archive, file.localHeaderOffset, file.compressedSize);
    total += inflatedLength(data, file.method, MAX_UNPACKED_BYTES - total);
    if (total > MAX_UNPACKED_BYTES) {
      throw new Error("Unpacks to too much");
    }
  }
  return total;
}

// The end-of-central-directory record sits in the last 22 bytes, or before a
// comment of up to 65,535 bytes. Searched from the end, as JSZip does.
function findEndRecord(archive: Buffer): CentralDirectory {
  const lowestStart = Math.max(0, archive.length - END_RECORD_SIZE - 0xffff);
  for (let start = archive.length - END_RECORD_SIZE; start >= lowestStart; start--) {
    if (archive.readUInt32LE(start) === END_OF_CENTRAL_DIRECTORY) {
      return readEndRecord(archive, start);
    }
  }
  throw new Error("Not a zip archive");
}

// The end record's numbers, when they describe one plain archive. A disk
// number, or a count of 0xffff, would send JSZip to zip64 records; a
// directory not ending right where this record starts would make it move
// every offset.
function readEndRecord(archive: Buffer, start: number): CentralDirectory {
  const diskNumber = archive.readUInt16LE(start + 4);
  const directoryDiskNumber = archive.readUInt16LE(start + 6);
  const entriesOnThisDisk = archive.readUInt16LE(start + 8);
  const entryCount = archive.readUInt16LE(start + 10);
  const directorySize = archive.readUInt32LE(start + 12);
  const offset = archive.readUInt32LE(start + 16);
  const commentLength = archive.readUInt16LE(start + 20);
  if (diskNumber !== 0 || directoryDiskNumber !== 0 || entriesOnThisDisk !== entryCount) {
    throw new Error("Split or zip64 archive");
  }
  // Also refuses 0xffff, zip64's marker.
  if (entryCount > MAX_FILES_IN_ARCHIVE) {
    throw new Error("Too many files in the archive");
  }
  if (offset + directorySize !== start) {
    throw new Error("The directory doesn't end at the end record");
  }
  if (start + END_RECORD_SIZE + commentLength !== archive.length) {
    throw new Error("Bytes after the end record");
  }
  return { entryCount, offset, endRecordStart: start };
}

// The directory's entries, read as JSZip reads them: one after the other for
// as long as an entry starts there. Throws unless that finds exactly the
// count the end record states and stops exactly at the end record.
function readCentralDirectory(archive: Buffer, directory: CentralDirectory): ArchivedFile[] {
  const files: ArchivedFile[] = [];
  let entryStart = directory.offset;
  while (archive.readUInt32LE(entryStart) === CENTRAL_DIRECTORY_ENTRY) {
    if (files.length === MAX_FILES_IN_ARCHIVE) {
      throw new Error("Too many files in the archive");
    }
    files.push(readCentralEntry(archive, entryStart));
    const nameLength = archive.readUInt16LE(entryStart + 28);
    const extraLength = archive.readUInt16LE(entryStart + 30);
    const commentLength = archive.readUInt16LE(entryStart + 32);
    entryStart += CENTRAL_ENTRY_SIZE + nameLength + extraLength + commentLength;
  }
  if (files.length !== directory.entryCount || entryStart !== directory.endRecordStart) {
    throw new Error("The directory doesn't match its end record");
  }
  return files;
}

function readCentralEntry(archive: Buffer, entryStart: number): ArchivedFile {
  const method = archive.readUInt16LE(entryStart + 10);
  const compressedSize = archive.readUInt32LE(entryStart + 20);
  const localHeaderOffset = archive.readUInt32LE(entryStart + 42);
  if (compressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
    throw new Error("zip64 archive");
  }
  return { method, compressedSize, localHeaderOffset };
}

// One file's packed bytes, after its local header.
function fileData(archive: Buffer, localHeaderOffset: number, compressedSize: number): Buffer {
  if (archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER) {
    throw new Error("Broken local header");
  }
  const nameLength = archive.readUInt16LE(localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  if (dataStart + compressedSize > archive.length) {
    throw new Error("File runs past the end of the archive");
  }
  return archive.subarray(dataStart, dataStart + compressedSize);
}

// How many bytes one file unpacks to, inflating at most budget + 1 of them.
function inflatedLength(data: Buffer, method: number, budget: number): number {
  if (method === STORED) {
    return data.length;
  }
  if (method !== DEFLATED) {
    throw new Error("Unknown compression");
  }
  return inflateRawSync(data, { maxOutputLength: Math.max(1, budget + 1) }).length;
}

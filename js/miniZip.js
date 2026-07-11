/*
Minimal browser-native ZIP reader.

Just enough to pull specific named JSON entries out of the KH1 AP patch
zip client-side — no external dependency. Decompression uses the
browser's built-in DecompressionStream("deflate-raw"), which is exactly
what Python's zipfile.ZIP_DEFLATED writes (raw DEFLATE, no zlib/gzip
wrapper), so this only needs to understand the ZIP container format
itself, not implement inflate.
*/

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(view) {
  const maxCommentLength = 65536;
  const searchFloor = Math.max(0, view.byteLength - 22 - maxCommentLength);

  for (let offset = view.byteLength - 22; offset >= searchFloor; offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error("Not a valid ZIP file (no end-of-central-directory record found).");
}

function readCentralDirectoryEntries(buffer) {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder();
  const entries = new Map();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cdOffset, true) !== ZIP_CENTRAL_DIR_SIGNATURE) {
      throw new Error("Malformed ZIP central directory.");
    }

    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const fileNameLength = view.getUint16(cdOffset + 28, true);
    const extraFieldLength = view.getUint16(cdOffset + 30, true);
    const fileCommentLength = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);

    const fileName = decoder.decode(new Uint8Array(buffer, cdOffset + 46, fileNameLength));
    entries.set(fileName, { compressionMethod, compressedSize, localHeaderOffset });

    cdOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Your browser can't extract zip files here (needs DecompressionStream — Chrome/Edge/Firefox 2023+ or Safari 16.4+).",
    );
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntryBytes(buffer, entry) {
  const view = new DataView(buffer);
  if (view.getUint32(entry.localHeaderOffset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error("Malformed ZIP local file header.");
  }

  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressedBytes = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.compressionMethod === 0) return compressedBytes.slice();
  if (entry.compressionMethod === 8) return inflateRaw(compressedBytes);
  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}

// Reads a File/Blob (a .zip) and returns { [fileName]: parsedJson } for
// whichever of the requested file names are actually present in the
// archive — names not found are simply omitted from the result.
async function readJsonFilesFromZip(zipFile, fileNames) {
  const buffer = await zipFile.arrayBuffer();
  const entries = readCentralDirectoryEntries(buffer);
  const decoder = new TextDecoder();

  const result = {};
  for (const name of fileNames) {
    const entry = entries.get(name);
    if (!entry) continue;
    const bytes = await readZipEntryBytes(buffer, entry);
    result[name] = JSON.parse(decoder.decode(bytes));
  }
  return result;
}

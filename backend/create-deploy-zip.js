#!/usr/bin/env node
/**
 * Creates a deploy zip for AWS Elastic Beanstalk with forward-slash paths.
 * Windows Compress-Archive uses backslashes which breaks Linux unzip on EB.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Use Node's built-in zlib + a minimal zip builder
// since we can't rely on archiver being installed
const zlib = require('zlib');

const OUTPUT = path.join(__dirname, '..', 'backend-deploy.zip');
const ROOT = __dirname; // backend/

// Files/dirs to EXCLUDE
const EXCLUDE = new Set([
  'node_modules',
  '.env',
  '.git',
  'uploads',
  'logs',
  'patient_records',
  'create-deploy-zip.js',
  'backend-deploy.zip',
  'test-db-connection.js',
  'test_bm.js',
  'test_output.html',
  'test_patient.html',
  'migrate-to-uid.js',
  'create-database.js',
  'upload-bench-audio-to-supabase.js',
  'nurseai-backend.zip',
]);

function collectFiles(dir, base = '') {
  const entries = [];
  for (const item of fs.readdirSync(dir)) {
    if (EXCLUDE.has(item)) continue;
    const fullPath = path.join(dir, item);
    const relPath = base ? `${base}/${item}` : item; // forward slashes!
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...collectFiles(fullPath, relPath));
    } else {
      entries.push({ fullPath, relPath, size: stat.size });
    }
  }
  return entries;
}

// Minimal ZIP file creator (Store method - no compression needed, EB handles it fine)
// Using deflate for smaller size
function createZip(files, outputPath) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.fullPath);
    const deflated = zlib.deflateRawSync(data);
    const nameBuffer = Buffer.from(file.relPath, 'utf8');
    const crc = crc32(data);
    const compressedSize = deflated.length;
    const uncompressedSize = data.length;

    // Local file header (30 bytes + name + data)
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(8, 8);             // compression: deflate
    local.writeUInt16LE(0, 10);            // mod time
    local.writeUInt16LE(0, 12);            // mod date
    local.writeUInt32LE(crc, 14);          // crc32
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);            // extra field length
    nameBuffer.copy(local, 30);

    localHeaders.push(Buffer.concat([local, deflated]));

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);  // signature
    central.writeUInt16LE(20, 4);           // version made by
    central.writeUInt16LE(20, 6);           // version needed
    central.writeUInt16LE(0, 8);            // flags
    central.writeUInt16LE(8, 10);           // compression: deflate
    central.writeUInt16LE(0, 12);           // mod time
    central.writeUInt16LE(0, 14);           // mod date
    central.writeUInt32LE(crc, 16);         // crc32
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);           // extra field length
    central.writeUInt16LE(0, 32);           // comment length
    central.writeUInt16LE(0, 34);           // disk number
    central.writeUInt16LE(0, 36);           // internal attrs
    central.writeUInt32LE(0, 38);           // external attrs
    central.writeUInt32LE(offset, 42);      // local header offset
    nameBuffer.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length + deflated.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((s, b) => s + b.length, 0);

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                 // disk number
  eocd.writeUInt16LE(0, 6);                 // disk with central dir
  eocd.writeUInt16LE(files.length, 8);      // entries on this disk
  eocd.writeUInt16LE(files.length, 10);     // total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);                // comment length

  const allBuffers = [...localHeaders, ...centralHeaders, eocd];
  fs.writeFileSync(outputPath, Buffer.concat(allBuffers));
}

// CRC32 implementation
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Main
console.log('Collecting files from backend/...');
const files = collectFiles(ROOT);
console.log(`Found ${files.length} files:`);
files.forEach(f => console.log(`  ${f.relPath}`));
console.log(`\nCreating ${OUTPUT}...`);
createZip(files, OUTPUT);
const stat = fs.statSync(OUTPUT);
console.log(`✅ Done! ${OUTPUT} (${(stat.size / 1024).toFixed(1)} KB)`);

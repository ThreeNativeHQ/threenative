/** A valid glTF 2.0 binary with a JSON chunk and no mesh data. */
export function minimalGlb() {
  const chunk = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }), 'utf8');
  const padded = Buffer.concat([chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + padded.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(padded.length, 0);
  chunkHeader.write('JSON', 4, 'ascii');
  return Buffer.concat([header, chunkHeader, padded]);
}

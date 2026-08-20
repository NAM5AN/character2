import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractZipEntry,
  htmlImages,
  MAX_PROFILE_IMAGE_BYTES,
  notionImages,
  zipMediaEntries,
} from '../src/lib/profile-image-parsers.ts';

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30 + name.length + entry.bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    entry.bytes.copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

test('Google Docs: DOCX media images are discovered in document order', () => {
  const docx = storedZip([
    { name: 'word/media/image1.png', bytes: Buffer.alloc(1024, 1) },
    { name: 'word/media/icon.svg', bytes: Buffer.alloc(4096, 2) },
    { name: 'word/media/image2.jpg', bytes: Buffer.alloc(4_715_684, 3) },
  ]);

  const entries=zipMediaEntries(docx);
  const images=entries.map(({name,contentType})=>({name,contentType}));
  assert.deepEqual(images, [
    { name: 'image1.png', contentType: 'image/png' },
    { name: 'image2.jpg', contentType: 'image/jpeg' },
  ]);
  assert.ok(4_715_684<MAX_PROFILE_IMAGE_BYTES);
  assert.equal(extractZipEntry(docx,entries[1]).byteLength,4_715_684);
});

test('Postype: article image URLs include lazy and srcset sources but exclude UI assets', () => {
  const html = `
    <body><img src="/outside-body.jpg"><article>
      <img class="logo" src="/logo.png">
      <img width="48" height="48" src="/avatar.png">
      <img data-src="https://images.example-cdn.com/uploads/character%20one.png">
      <img srcset="/uploads/small.jpg 320w, /uploads/full.jpg 1280w">
      <img src="/uploads/full.jpg">
    </article></body>`;

  const images=htmlImages(html,new URL('https://www.postype.com/@author/post/123'));
  assert.deepEqual(images, [
    { url: 'https://images.example-cdn.com/uploads/character%20one.png', name: 'character one.png' },
    { url: 'https://www.postype.com/uploads/full.jpg', name: 'full.jpg' },
  ]);
});

test('Notion: attachment-backed image uses its signed URL', () => {
  const pageId = '2319a5e0-5929-8000-a45f-d58ac2aa31ba';
  const imageBlockId = '23390000-0000-0000-0000-00000000e710';
  const recordMap = {
    block: {
      [pageId]: { value: { id: pageId, type: 'page', content: [imageBlockId] } },
      [imageBlockId]: {
        value: {
          id: imageBlockId,
          type: 'image',
          properties: { source: [['attachment:839c77cf-225e-413d-8458-b66e71f5fe8f:250716.jpg']] },
          format: { display_source: 'attachment:839c77cf-225e-413d-8458-b66e71f5fe8f:250716.jpg' },
        },
      },
    },
    signed_urls: { [imageBlockId]: 'https://file.notion.com/signed/250716.jpg?signature=fresh' },
  };

  assert.deepEqual(notionImages(recordMap,pageId),[{
    url:'https://file.notion.com/signed/250716.jpg?signature=fresh',
    name:'250716.jpg',
    key:imageBlockId,
  }]);
});

test('Notion: a public HTTPS image remains a fallback when no signed URL exists',()=>{
  const pageId='11111111-1111-1111-1111-111111111111';
  const imageBlockId='22222222-2222-2222-2222-222222222222';
  const recordMap={
    block:{
      [pageId]:{value:{id:pageId,type:'page',content:[imageBlockId]}},
      [imageBlockId]:{value:{id:imageBlockId,type:'image',properties:{source:[['https://cdn.example.com/profile.webp']]}}},
    },
    signed_urls:{},
  };
  assert.deepEqual(notionImages(recordMap,pageId),[{
    url:'https://cdn.example.com/profile.webp',
    name:'profile.webp',
    key:imageBlockId,
  }]);
});

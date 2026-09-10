import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { SPOT_BLUE, SPOT_MARK_PATH } from "../lib/spot-mark.ts";
import { SPOT_WORDMARK } from "../lib/spot-wordmark.ts";

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 65" width="65" height="65" fill="none">
  <circle cx="32.5" cy="32.5" r="31" fill="none" stroke="${SPOT_BLUE}" stroke-width="1.25"/>
  <path d="${SPOT_MARK_PATH}" fill="${SPOT_BLUE}"/>
</svg>
`;

function lockupSvg(wordColor) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPOT_WORDMARK.width} ${SPOT_WORDMARK.height}" width="${SPOT_WORDMARK.width}" height="${SPOT_WORDMARK.height}" fill="none">
  <path d="${SPOT_WORDMARK.path}" fill="${wordColor}"/>
  <g transform="translate(0 0) scale(3.076923)">
    <circle cx="32.5" cy="32.5" r="31" fill="none" stroke="${SPOT_BLUE}" stroke-width="1.25"/>
    <path d="${SPOT_MARK_PATH}" fill="${SPOT_BLUE}"/>
  </g>
</svg>
`;
}

const bimiSvg = `<svg version="1.2" baseProfile="tiny-ps" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Spot</title>
  <rect width="1024" height="1024" fill="#ffffff"/>
  <g transform="translate(332,332) scale(5.538)">
    <circle cx="32.5" cy="32.5" r="31" fill="none" stroke="${SPOT_BLUE}" stroke-width="1.25"/>
    <path d="${SPOT_MARK_PATH}" fill="${SPOT_BLUE}"/>
  </g>
</svg>
`;

function ico(images) {
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = directorySize;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const lightLockup = lockupSvg("#000000");
const darkLockup = lockupSvg("#ffffff");
await Promise.all([
  writeFile("public/brand/mark.svg", markSvg),
  writeFile("public/brand/spot-lockup.svg", lightLockup),
  writeFile("public/brand/spot-lockup-light.svg", darkLockup),
  writeFile("public/spot-icon.svg", markSvg),
  writeFile("app/icon.svg", markSvg),
  writeFile("public/logo-bimi.svg", bimiSvg),
]);

const mark = Buffer.from(markSvg);
const iconPng = await sharp(mark).resize(260, 260).png().toBuffer();
const iconJpg = await sharp(mark)
  .resize(224, 224)
  .flatten({ background: "#ffffff" })
  .extend({ top: 16, bottom: 16, left: 16, right: 16, background: "#ffffff" })
  .jpeg({ quality: 95 })
  .toBuffer();
const faviconImages = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    png: await sharp(mark).resize(size, size).png().toBuffer(),
  })),
);

await Promise.all([
  writeFile("public/spot/logo-icon.png", iconPng),
  writeFile("public/spot-icon.jpg", iconJpg),
  writeFile("app/favicon.ico", ico(faviconImages)),
  writeFile(
    "public/brand/spot-lockup@1x.png",
    await sharp(Buffer.from(lightLockup)).resize(514, 100).png().toBuffer(),
  ),
  writeFile(
    "public/brand/spot-lockup@2x.png",
    await sharp(Buffer.from(lightLockup)).resize(1028, 200).png().toBuffer(),
  ),
  writeFile(
    "public/brand/spot-lockup-light@1x.png",
    await sharp(Buffer.from(darkLockup)).resize(514, 100).png().toBuffer(),
  ),
  writeFile(
    "public/brand/spot-lockup-light@2x.png",
    await sharp(Buffer.from(darkLockup)).resize(1028, 200).png().toBuffer(),
  ),
]);

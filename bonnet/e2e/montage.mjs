// node e2e/montage.mjs out.png in1.png in2.png ...  -> side-by-side contact sheet (each tile 260 wide)
import sharp from 'sharp';
const [, , out, ...ins] = process.argv;
const W = 260;
const tiles = await Promise.all(ins.map((f) => sharp(f).resize({ width: W }).png().toBuffer()));
const meta = await sharp(tiles[0]).metadata();
await sharp({ create: { width: W * tiles.length, height: meta.height, channels: 3, background: '#000' } })
  .composite(tiles.map((input, i) => ({ input, left: i * W, top: 0 })))
  .png()
  .toFile(out);

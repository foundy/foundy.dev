// Size comparison of SDF encodings (lossless / near-lossless WebP vs PNG) for the baked field. Not part of the build.
import sharp from 'sharp';
const src = 'public/gl/wordmark-sdf.png';
const m = await sharp(src).metadata();
console.log('source', m.width, m.height, m.channels);
const raw = await sharp(src).greyscale().raw().toBuffer();
const img = () => sharp(raw, { raw: { width: m.width, height: m.height, channels: 1 } });
const kb = (b) => (b.length / 1024).toFixed(1) + ' KB';
console.log('png', kb(await img().png({ compressionLevel: 9, effort: 10 }).toBuffer()));
console.log('webp lossless', kb(await img().webp({ lossless: true, effort: 6 }).toBuffer()));
for (const nl of [90, 80, 70, 60, 50, 40]) console.log('webp nearLossless', nl, kb(await img().webp({ lossless: true, nearLossless: true, quality: nl, effort: 6 }).toBuffer()));
for (const q of [95, 90, 85]) console.log('webp lossy q', q, kb(await img().webp({ quality: q, effort: 6 }).toBuffer()));
for (const w of [1236, 1545]) console.log('png resized', w, kb(await img().resize(w).png({ compressionLevel: 9, effort: 10 }).toBuffer()));

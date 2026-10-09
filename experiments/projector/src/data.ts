// Product-agnostic content model (copied from bonnet/, trimmed). ?set=bonnet | mixed
export interface Product { id: string; title: string; price: string; images: string[]; desc: string; details: [string, string[]][] }
const q = new URLSearchParams(location.search);
export const SET = q.get('set') === 'mixed' ? 'mixed' : 'bonnet';
const BONNET_COPY = 'A soft shell-stitch bonnet worked in one piece, with a ruffled edge that frames the face and a ribbon that ties under the chin. Each stitch is a small loop, and the loops add up to a shape that holds.';
const bonnet = (id: string, title: string, file: string, angles = ['front', 'right', 'back', 'left']): Product => ({
  id, title: `${title} bonnet`, price: '$48 (mock)', images: angles.map((a) => `raw/bonnet-${file}-${a}.webp`), desc: BONNET_COPY,
  details: [['Materials', ['Mercerized cotton, 100%', 'Mother-of-pearl style button closure', 'Cotton ribbon ties']], ['Sizes', ['0-3 months', '3-6 months', '6-12 months']], ['Care', ['Hand wash cool, reshape and dry flat.']]],
});
const mixed = (id: string, title: string, price: string, images: string[], desc: string): Product => ({ id, title, price, images, desc, details: [['Details', ['Demo catalogue item', 'Photo: Pexels (see CREDITS.md)']]] });
const SET_BONNET: Product[] = [bonnet('ivory', 'Ivory', 'ivory', ['front']), bonnet('moss', 'Moss', 'green'), bonnet('poppy', 'Poppy', 'red'), bonnet('sky', 'Sky', 'skyblue'), bonnet('butter', 'Butter', 'yellow')];
const SET_MIXED: Product[] = [
  mixed('field-cap', 'Field cap', '$64 (mock)', ['catalog/model.webp'], 'A person wearing the product: tall portrait, face in the upper third.'),
  mixed('atomiser', 'Glass atomiser', '$32 (mock)', ['catalog/bottle.webp'], 'A transparent object on a near-white backdrop: almost no contrast.'),
  mixed('sake-shelf', 'Label shelf', '$18 (mock)', ['catalog/text.webp', 'catalog/text2.webp'], 'Text-heavy packaging with small print: any unwanted blur is obvious here.'),
  mixed('skincare', 'Skincare flat-lay', '$41 (mock)', ['catalog/flat.webp'], 'A square flat-lay on white, with fine product typography.'),
  mixed('ceramics', 'Ceramic collection', '$120 (mock)', ['catalog/wide.webp'], 'A very wide 16:9 shot.'),
  mixed('summer-hat', 'Summer hat', '$58 (mock)', ['catalog/tall.webp'], 'A very tall 9:16 shot.'),
];
export const PRODUCTS = SET === 'mixed' ? SET_MIXED : SET_BONNET;
export const N_SLOTS = Math.max(PRODUCTS.length, 12);
export const imgUrl = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;

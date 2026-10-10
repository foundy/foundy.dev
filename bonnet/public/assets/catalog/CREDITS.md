# Mixed catalogue image credits

All photos are from Pexels and used under the Pexels License (free to use, attribution not required but given here).
Originals were downloaded (via the Pexels CDN, `w=1600`) into an empty scratch directory and treated as untrusted data
(decoded only by sharp as images). Output: WebP q80, long side <= 1200 px, sRGB, no ICC (`scripts/prep-images.mjs`).

| File | Role | Title | Author | Source | Processing |
|------|------|-------|--------|--------|------------|
| model.webp | person wearing a product | Woman Wearing Hat | Konstantin Mishchenko | https://www.pexels.com/photo/woman-wearing-hat-2010812/ | resize |
| bottle.webp | transparent glass bottle | Clear Glass Bottle With Green Cap | Dina Nasyrova | https://www.pexels.com/photo/clear-glass-bottle-with-green-cap-3831748/ | resize |
| text.webp | text-heavy packaging (labels) | Sake Bottles on Display Shelf - Japanese Beverage | Vincent Rivaud | https://www.pexels.com/photo/sake-bottles-on-display-shelf-japanese-beverage-37964149/ | resize |
| text2.webp | 2nd image of the packaging product | Bottles of Japanese Beer | Andy Lee | https://www.pexels.com/photo/bottles-of-japanese-beer-18341856/ | resize |
| flat.webp | flat-lay on white | Luxury Skincare Beauty Products on White Background | Misolo Cosmetic | https://www.pexels.com/photo/luxury-skincare-beauty-products-on-white-background-4841273/ | resize |
| wide.webp | very wide (16:9) | Ceramics home decor | Ionela Mat | https://www.pexels.com/photo/ceramics-home-decor-27180805/ | centre crop 3:2 -> 16:9, resize |
| tall.webp | very tall (9:16) | Model in Summer Dress and Hat | Alax Matias | https://www.pexels.com/photo/model-in-summer-dress-and-hat-17041991/ | centre crop 2:3 -> 9:16, resize |

Bonnet photos (`../raw/`) and `bonnet-ivory-front.webp` are the project's own sample renders.

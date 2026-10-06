---
title: Hero Shader
summary: The first screen of this site is a shader you can take apart, built as four stages that each render on their own.
kicker: SDF wordmark, domain warp, flow field, ink and paper.
order: 1
year: 2026
role: Design and engineering
stack: [TypeScript, three.js TSL, WebGPU, WebGL2, GLSL]
mock: true
facts:
  - { label: 'Pipeline', value: 'Four stages, each renderable alone' }
  - { label: 'Weight', value: '8 KB gzipped, loaded after first paint' }
  - { label: 'Fallback', value: 'The same wordmark as SVG, still a finished piece' }
preview:
  - 'The first screen is a shader you can touch and then take apart. Switch on Inspect and the picture falls back through its own stages: a distance field of the letters, a warped noise, a flow field, and finally ink on paper.'
  - 'It is plain WebGL2 with a small GLSL pipeline. Three.js and WebGPU were prototyped and measured, and the smaller path won on weight and on how evenly it runs on a mid-range phone.'
  - 'When there is no GL, or the visitor asks for reduced motion, the page shows pre-rendered stills of every stage, so the explanation survives the fallback.'
---

## Problem

A portfolio for someone who works with graphics should open with graphics. The easy version of that is a full-screen noise field behind a name, and it is everywhere: it looks the same on every site, it hides the text, and it falls apart on a mid-range phone.

I wanted the opposite. The image had to be legible as an image of the word "foundy" first, behave like ink on paper second, and cost almost nothing before the user touched it. It also had to be something I could explain, because a hero that cannot be explained is only decoration.

The constraints I set before writing any shader code:

- The largest contentful paint is text and SVG, never the canvas.
- Every stage of the effect renders as a standalone image, so it can be shown in isolation later.
- The same page works with WebGPU, with WebGL2 only, and with no GL at all.
- A mid-range phone holds 60 fps at the default quality tier.

## Choices and alternatives

**Shape from a signed distance field.** The wordmark is rasterised once into a signed distance field, so every later stage can ask "how far inside the letter is this pixel?" instead of sampling a bitmap. I tried drawing the letters analytically with arcs and boxes, which gave perfect edges but made every wordmark change a maths exercise. An SDF baked from the font was less pure and much easier to live with.

**Domain warp for the ink edge.** Offsetting the lookup coordinates with two octaves of curl-ish noise gives the edge its bleed. Three octaves looked richer and cost 40 percent more per frame at 1080p; the third octave was invisible at the sizes people actually see.

**A flow field instead of particles.** Particles that scatter the name are the most common move on this kind of site. A velocity field advects the ink instead: the cursor adds force to the field, the field pushes the ink, and the word always settles back into itself. Nothing is spawned, so cost does not scale with how much you wiggle the mouse.

**Composite last.** The final stage maps the ink density onto a paper texture with a little grain and a faint offset, so the result reads as print, not light.

**Renderer.** I wrote the stages as TSL nodes so the same graph targets WebGPU and falls back to WebGL2. The alternative was hand-written GLSL for each backend. TSL won because each stage is already a separate node, which is exactly the shape the later inspector needs, but I verify both backends separately because feature parity is not guaranteed.

## What it does

The page ships a static SVG poster of the wordmark first. When the GL chunk has loaded and compiled, the canvas cross-fades over the poster; if anything fails, the poster simply stays. The pipeline is:

1. **SDF wordmark.** Distance to the letterforms, baked once at load.
2. **Domain warp.** Two octaves of noise bend the lookup coordinates.
3. **Flow field.** A low-resolution velocity grid, updated from pointer motion, advects the ink.
4. **Ink and paper composite.** Density becomes tone, grain and edge softness.

<figure class="placeholder" aria-label="Pointer to the live Inspect on the home page">
  <div class="placeholder__frame">
    <span class="label">Interactive figure</span>
    <p>Turn on Inspect at the top of the <a href="/">home page</a> (or press I). A slider peels the hero apart into these four stages, each with a plain-English explanation and, if you want them, the developer numbers. The ink stays live while you look, so you can push it and watch each stage react.</p>
  </div>
  <figcaption>Fig. 1. The four stages, rendered independently. Live on the home page; this slot becomes an embedded copy later.</figcaption>
</figure>

### Performance budget

| Item | Budget | Measured (mock) |
| --- | --- | --- |
| Client JS before interaction | 0 KB | 0 KB |
| GL chunk, gzipped | 90 KB | 71 KB |
| First frame after chunk load | 120 ms | 84 ms |
| Frame time, default tier, mid-range phone | 8 ms | 6.2 ms |
| Shader compile, cold | 250 ms | 190 ms |

The renderer picks one of three quality tiers from measured frame times rather than from a device list. If the median of the last sixty frames exceeds 12 ms it drops the simulation resolution by a quarter, and it pauses entirely when the canvas is off screen or the tab is hidden.

## Outcome and limits

The hero holds its frame budget on the devices I tested, the text is always the largest paint, and with GL disabled the page still looks like a poster rather than an error. Each stage can be rendered on its own, which is what the inspector in Phase 4 builds on.

Limits worth stating plainly:

- WebGL2 and WebGPU do not produce pixel-identical ink. The difference is small, but it is there, and I treat WebGL2 as the reference.
- The flow field is low resolution on purpose. Pushing it higher added detail nobody asked for.
- `prefers-reduced-motion` freezes the flow and keeps a single static frame, which is a decision about comfort, not about performance.
- Numbers on this page are placeholders until the measurement pass in Phase 2.

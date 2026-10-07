// MOCK: replace with real content
//
// Everything on the static site that is "about the person" lives here, so one
// pass over this file (plus `mock: true` in src/content/work/*.md) replaces
// all placeholder copy. When the real content is in, set `mock = false`.

export const mock = true;

export const site = {
  name: 'foundy',
  url: 'https://foundy.dev',
  role: 'Frontend developer working on graphics, shaders and interaction.',
  tagline: 'Frontend developer working on graphics, shaders and interaction.',
  description:
    'foundy is a frontend developer focused on graphics, shaders and interaction design for the web.',
  availability: 'Open to select projects',
  location: 'Seoul, KR (UTC+9)',
  year: 2026,
};

export const nav = [
  { label: 'Work', href: '/#work' },
  { label: 'Lab', href: '/lab' },
  { label: 'About', href: '/#about' },
  { label: 'Contact', href: '/#contact' },
];

export const about = {
  lede: 'I build interfaces where the image itself is the interface: shaders that respond, gestures that feel physical, and pages that stay fast while they do it.',
  paragraphs: [
    'Most of my days are spent in the gap between design and engineering. I like the part of a project where a motion spec meets a frame budget, and someone has to decide what actually ships.',
    'I work mostly with TypeScript, WebGL and CSS, and I care about the unglamorous layer underneath: accessible markup, sensible fallbacks, and code another person can read a year later.',
    'This site is also a notebook. The two case studies are the work I would most like to be judged by, because both of them include the versions that did not work.',
  ],
  skills: [
    ['Graphics', 'WebGL2, WebGPU, GLSL / TSL, SDFs, noise'],
    ['Interaction', 'Pointer events, springs, gesture models'],
    ['Front end', 'TypeScript, Astro, CSS, accessibility'],
    ['Tooling', 'Vite, profiling, CI, Claude Code'],
  ] as [string, string][],
};

export const now = {
  updatedAt: '2026-10-06',
  items: [
    ['Building', 'The hero shader for this site, one stage at a time'],
    ['Reading', 'Real-time rendering notes on signed distance fields'],
    ['Testing', 'Release-velocity thresholds for pull-down gestures'],
    ['Writing', 'Case studies that include the failed versions'],
  ] as [string, string][],
};

export const contact = {
  email: 'hello@example.com',
  note: 'Questions, collaborations, or a good shader you think I should look at. A short email is the best way in.',
  socials: [
    { label: 'GitHub', href: 'https://github.com/foundy', handle: '@foundy' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/example', handle: 'in/example' },
    { label: 'Bluesky', href: 'https://bsky.app/profile/example.com', handle: '@example.com' },
    { label: 'Read.cv', href: 'https://read.cv/example', handle: 'read.cv/example' },
  ],
};

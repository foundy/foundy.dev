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

/** Lab: the four decisions from the card interaction study. */
export const labEntries = [
  {
    n: '01',
    title: 'Close on velocity and distance, not distance alone',
    versions: 'v3 → v12',
    decision:
      'A pull-down closes the card when either the release velocity passes 1.2 px/ms or the travel passes 38% of the card height.',
    why: 'With a distance-only threshold, quick short flicks were cancelled and slow long drags were closed by accident. People judge intent by speed first and distance second, so the rule now does too.',
    metric: '1.2 px/ms or 38%',
  },
  {
    n: '02',
    title: 'Rubber-band resistance instead of a hard stop',
    versions: 'v6 → v9',
    decision:
      'Past the close threshold the card keeps following the finger, but at a decaying ratio that approaches 0.35.',
    why: 'A hard stop felt like a bug; free 1:1 tracking felt like nothing was happening. Resistance communicates that the gesture has been understood and still has a limit.',
    metric: 'ratio 1 → 0.35',
  },
  {
    n: '03',
    title: 'Freeze the close rect before the transition starts',
    versions: 'v14 → v18',
    decision:
      'The close animation reads the card rectangle once, at release, and animates from that frozen rect to the origin slot.',
    why: 'Reading layout during the transition caused a one-frame jump whenever the page scrolled or resized mid-gesture. A frozen rect makes the animation a pure function of its start state.',
    metric: '0 reads / frame',
  },
  {
    n: '04',
    title: 'Springs advance on time, not on frames',
    versions: 'v16 → v20',
    decision:
      'Spring state is integrated with the real elapsed time per frame, clamped to 32 ms, with a fixed sub-step of 4 ms.',
    why: 'Frame-based stepping made the same gesture feel different on 60 Hz and 120 Hz screens, and a dropped frame turned into a visible stall. Time-based stepping behaves the same everywhere.',
    metric: '4 ms sub-step',
  },
];

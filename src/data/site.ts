// Personal info (role, location, about, now, contact) is real and lives here.
// Case studies (`mock: true` in src/content/work/*.md) and the Lab still carry
// placeholder numbers, so they keep their own per-item mock badges.

/** Lab copy still contains mock numbers (see src/data/lab/decisions.ts). */
export const labMock = true;

export const site = {
  name: 'foundy',
  url: 'https://foundy.dev',
  role: 'Frontend developer working on graphics and interaction, and experimenting with AI.',
  tagline: 'Frontend developer in Korea, working on graphics and interaction, and experimenting with AI in the workflow.',
  description:
    'foundy is a frontend developer in Korea, working on graphics and interaction for the web and experimenting with AI in the development workflow.',
  focus: 'Frontend · Graphics · AI workflows',
  location: 'Korea (KST, UTC+9)',
  year: 2026,
};

export const nav = [
  { label: 'Work', href: '/#work' },
  { label: 'Lab', href: '/lab' },
  { label: 'About', href: '/#about' },
  { label: 'Contact', href: '/#contact' },
];

export const about = {
  lede: 'I am a frontend developer in Korea. I like interfaces that respond: shaders, gestures that feel physical, and pages that stay fast while they do it.',
  paragraphs: [
    'This site is the clearest example. The hero is a WebGL2 shader written in GLSL, the cards run on Pointer Events and springs, and the page is plain TypeScript and Astro with a poster fallback when GL is not available.',
    'I also experiment with AI in my own workflow: a development environment managed with Claude Code, an AI agent I can task remotely through Discord, AI-assisted codebase analysis, and smaller experiments such as scheduling with Google Calendar and a game data analyzer.',
  ],
  skills: [
    ['Graphics', 'WebGL2, GLSL, SDFs, noise'],
    ['Interaction', 'Pointer Events, springs, gesture models'],
    ['Front end', 'TypeScript, Astro, CSS'],
    ['AI workflows', 'Claude Code, MCP, LLM-assisted review'],
  ] as [string, string][],
};

export const now = {
  updatedAt: '2026-10-07',
  items: [
    ['Building', 'This site: the hero shader and its Inspect view, live'],
    ['Exploring', 'AI-augmented dev workflows'],
    ['Testing', 'An LLM-driven code review pipeline'],
  ] as [string, string][],
};

export const contact = {
  email: 'afoundy@gmail.com',
  note: 'Questions, collaborations, or something you think I should look at. A short email is the best way in.',
  socials: [
    { label: 'GitHub', href: 'https://github.com/foundy', handle: '@foundy' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/foundy', handle: 'in/foundy' },
  ],
};

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const work = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    order: z.number(),
    year: z.number(),
    role: z.string(),
    stack: z.array(z.string()),
    /** Short line for the work index (falls back to summary). */
    kicker: z.string().optional(),
    /** MOCK: true while the entry holds placeholder copy and numbers. */
    mock: z.boolean().default(false),
    /** Preview sheet (home): three key facts and a few short paragraphs. MOCK while `mock` is true. */
    facts: z.array(z.object({ label: z.string(), value: z.string() })).max(3).default([]),
    preview: z.array(z.string()).default([]),
  }),
});

export const collections = { work };

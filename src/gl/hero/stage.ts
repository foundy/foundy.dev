/** The four pipeline stages. Each can be rendered alone (`?stage=`, and later the Inspect overlay). */
export const HeroStage = {
  Sdf: 'sdf',
  Warp: 'warp',
  Flow: 'flow',
  Composite: 'composite',
} as const;
export type HeroStage = (typeof HeroStage)[keyof typeof HeroStage];

export const HERO_STAGES: readonly HeroStage[] = [HeroStage.Sdf, HeroStage.Warp, HeroStage.Flow, HeroStage.Composite];

export function parseStage(v: string | null | undefined): HeroStage | null {
  return HERO_STAGES.includes(v as HeroStage) ? (v as HeroStage) : null;
}

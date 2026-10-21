// Table geometry & physics constants (table-space units: play area 200 x 100)

export const PLAY_W = 200
export const PLAY_H = 100
export const RAIL = 15
export const TABLE_W = PLAY_W + RAIL * 2
export const TABLE_H = PLAY_H + RAIL * 2

export const BALL_R = 4.4
export const POCKET_R_CORNER = 10.2
export const POCKET_R_SIDE = 9.2
export const CORNER_MOUTH = 12.5 // gap along rail from each corner
export const SIDE_MOUTH = 9.5 // gap each side of side pocket centre

// Physics
export const MAX_SHOT_SPEED = 560
export const MIN_SHOT_SPEED = 30
export const FRICTION_DECEL = 34 // units/s^2 rolling deceleration
export const CUSHION_RESTITUTION = 0.78
export const BALL_RESTITUTION = 0.955
export const STOP_SPEED = 2.2
export const DT = 1 / 120
export const MAX_SIM_TIME = 22

/** Funnel pull (units/s^2 at the pocket centre) that bends near-miss paths into the hole. */
export const POCKET_PULL = 300

export type BallType = 'solid' | 'stripe' | 'eight' | 'cue'
export type Group = 'solid' | 'stripe'

export interface Ball {
  id: number // 0 = cue, 1..15
  x: number
  y: number
  vx: number
  vy: number
  active: boolean // false once potted
  sinking?: number // 0..1 sink animation progress
  sinkPocket?: number // pocket index while sinking
}

export interface Pocket {
  x: number
  y: number
  r: number
  corner: boolean
}

export const POCKETS: Pocket[] = [
  { x: 0, y: 0, r: POCKET_R_CORNER, corner: true },
  { x: PLAY_W / 2, y: -1.2, r: POCKET_R_SIDE, corner: false },
  { x: PLAY_W, y: 0, r: POCKET_R_CORNER, corner: true },
  { x: 0, y: PLAY_H, r: POCKET_R_CORNER, corner: true },
  { x: PLAY_W / 2, y: PLAY_H + 1.2, r: POCKET_R_SIDE, corner: false },
  { x: PLAY_W, y: PLAY_H, r: POCKET_R_CORNER, corner: true },
]

export function ballType(id: number): BallType {
  if (id === 0) return 'cue'
  if (id === 8) return 'eight'
  return id < 8 ? 'solid' : 'stripe'
}

export const BALL_COLORS: Record<number, string> = {
  0: '#f8f6f0',
  1: '#e8b323',
  2: '#1c53c4',
  3: '#d0342c',
  4: '#6d3aa8',
  5: '#e2762a',
  6: '#1e7d46',
  7: '#8c2c25',
  8: '#191919',
  9: '#e8b323',
  10: '#1c53c4',
  11: '#d0342c',
  12: '#6d3aa8',
  13: '#e2762a',
  14: '#1e7d46',
  15: '#8c2c25',
}

export interface CushionSeg {
  x1: number
  y1: number
  x2: number
  y2: number
}

// Cushion segments with gaps at pocket mouths (jaw endpoints act as round bumpers)
export const CUSHIONS: CushionSeg[] = [
  // top rail (y = 0), two segments
  { x1: CORNER_MOUTH, y1: 0, x2: PLAY_W / 2 - SIDE_MOUTH, y2: 0 },
  { x1: PLAY_W / 2 + SIDE_MOUTH, y1: 0, x2: PLAY_W - CORNER_MOUTH, y2: 0 },
  // bottom rail (y = PLAY_H)
  { x1: CORNER_MOUTH, y1: PLAY_H, x2: PLAY_W / 2 - SIDE_MOUTH, y2: PLAY_H },
  { x1: PLAY_W / 2 + SIDE_MOUTH, y1: PLAY_H, x2: PLAY_W - CORNER_MOUTH, y2: PLAY_H },
  // left rail
  { x1: 0, y1: CORNER_MOUTH, x2: 0, y2: PLAY_H - CORNER_MOUTH },
  // right rail
  { x1: PLAY_W, y1: CORNER_MOUTH, x2: PLAY_W, y2: PLAY_H - CORNER_MOUTH },
]

export interface ShotEvents {
  firstContact: number | null
  potted: number[]
  cuePotted: boolean
  anyRailAfterContact: boolean
  duration: number
}

export interface RulesState {
  turn: 0 | 1
  groups: [Group | null, Group | null]
  phase: 'break' | 'open' | 'assigned' | 'over'
  ballInHand: boolean
  kitchenOnly: boolean // break placement constraint
  winner: 0 | 1 | null
  winReason: string | null
  foul: boolean
  foulReason: string | null
  message: string
}

export interface PlayerInfo {
  name: string
  isBot: boolean
  difficulty?: 'easy' | 'medium' | 'hard'
}

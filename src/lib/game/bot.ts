// Bot AI: evaluates candidate shots by running the physics simulation headlessly.
import {
  BALL_R,
  MAX_SHOT_SPEED,
  PLAY_H,
  PLAY_W,
  POCKETS,
  ballType,
  type Ball,
  type Group,
  type PlayerInfo,
  type RulesState,
} from './constants'
import { PhysicsSim } from './physics'
import { applyShot, canPlaceCue, groupCleared } from './rules'

export interface BotShot {
  angle: number
  power: number // speed units/s (<= MAX_SHOT_SPEED)
}

interface Candidate extends BotShot {
  score: number
}

const DIFFICULTY_CFG = {
  easy: { powers: [0.5, 0.85], jitter: 0.055, pickTop: 4, placements: 1, think: 650 },
  medium: { powers: [0.4, 0.65, 0.9], jitter: 0.018, pickTop: 2, placements: 4, think: 900 },
  hard: { powers: [0.35, 0.55, 0.75, 1.0], jitter: 0.004, pickTop: 1, placements: 7, think: 1100 },
} as const

type Difficulty = NonNullable<PlayerInfo['difficulty']>

/** Score a simulated shot from the shooter's perspective. */
function scoreShot(
  prev: RulesState,
  ballsAfter: Ball[],
  potted: number[],
  cuePotted: boolean,
  firstContact: number | null,
  shooter: 0 | 1
): number {
  const opponent = shooter === 0 ? 1 : 0
  const outcome = applyShot(prev, ballsAfter, {
    firstContact,
    potted,
    cuePotted,
    anyRailAfterContact: true,
    duration: 1,
  })
  const rules = outcome.next
  if (rules.phase === 'over') {
    return rules.winner === shooter ? 10000 : -10000
  }

  const myGroup: Group | null = prev.groups[shooter]
  let score = 0
  for (const id of potted) {
    const t = ballType(id)
    if (t === 'eight') continue // handled via rules outcome
    if (myGroup === null) score += 100 // open table: potting anything assigns a group
    else if (t === myGroup) score += 130
    else score -= 70 // gave opponent's ball away
  }
  if (cuePotted) score -= 260
  else if (firstContact === null) score -= 300 // no contact foul
  else if (rules.foul) score -= 240

  // keep the 8 on the table until the group is cleared (implicitly handled), plus
  // tiny nudge to prefer leaving the cue near own side of the table centre
  const cue = ballsAfter.find((b) => b.id === 0)
  if (cue && cue.active) {
    const centreDist = Math.hypot(cue.x - PLAY_W / 2, cue.y - PLAY_H / 2)
    score -= centreDist * 0.15
  }
  return score
}

/** Simulate one candidate and return its score. */
function simulate(prev: RulesState, balls: Ball[], angle: number, speed: number, shooter: 0 | 1): number {
  const sim = new PhysicsSim(balls)
  sim.runToEnd()
  return scoreShot(prev, sim.balls, sim.events().potted, sim.events().cuePotted, sim.events().firstContact, shooter)
}

function aimCandidates(
  rules: RulesState,
  balls: Ball[],
  difficulty: Difficulty
): { angle: number; power: number }[] {
  const cfg = DIFFICULTY_CFG[difficulty]
  const shooter = rules.turn
  const myGroup = rules.groups[shooter]
  const cue = balls.find((b) => b.id === 0)
  if (!cue || !cue.active) return []

  // legal target set
  let targets: number[] = []
  if (rules.phase === 'break') {
    targets = balls.filter((b) => b.active && b.id !== 0).map((b) => b.id)
  } else if (myGroup === null) {
    targets = balls.filter((b) => b.active && b.id !== 0 && b.id !== 8).map((b) => b.id)
  } else if (groupCleared(balls, myGroup)) {
    targets = [8]
  } else {
    targets = balls.filter((b) => b.active && ballType(b.id) === myGroup).map((b) => b.id)
  }

  const out: { angle: number; power: number }[] = []
  const TWO_R = BALL_R * 2
  for (const id of targets) {
    const t = balls.find((b) => b.id === id && b.active)
    if (!t) continue
    for (const pk of POCKETS) {
      // pocket mouth aim point (slightly inside the pocket)
      const pocketAim = { x: pk.x, y: pk.y }
      const dx = pocketAim.x - t.x
      const dy = pocketAim.y - t.y
      const distPocket = Math.hypot(dx, dy)
      if (distPocket < 0.001) continue
      const gx = t.x - (dx / distPocket) * TWO_R
      const gy = t.y - (dy / distPocket) * TWO_R
      const adx = gx - cue.x
      const ady = gy - cue.y
      const distAim = Math.hypot(adx, ady)
      if (distAim < 0.001) continue
      // cut angle feasibility: angle between aim line and target->pocket line
      const cosCut = (adx / distAim) * (dx / distPocket) + (ady / distAim) * (dy / distPocket)
      if (cosCut < 0.25) continue // > ~75.5 deg cut, too thin
      const baseAngle = Math.atan2(ady, adx)
      const cutFactor = 0.55 + 0.45 * cosCut // thin cuts need more power
      for (const p of cfg.powers) {
        out.push({
          angle: baseAngle,
          power: Math.min(MAX_SHOT_SPEED, MAX_SHOT_SPEED * p * cutFactor),
        })
      }
      if (difficulty === 'hard' && cosCut > 0.8) {
        // add a soft touch option for near-straight shots
        out.push({ angle: baseAngle, power: MAX_SHOT_SPEED * 0.3 * cutFactor })
      }
    }
  }

  // jitter applied by caller (keeps candidates deterministic per difficulty)
  return out
}

/** Choose the bot's shot. Returns angle/power; also returns a cue placement when ball in hand. */
export function botDecide(
  rules: RulesState,
  ballsIn: Ball[],
  difficulty: Difficulty
): BotShot & { placeCue?: { x: number; y: number } } {
  const cfg = DIFFICULTY_CFG[difficulty]
  const rng = Math.random
  const shooter = rules.turn

  let balls = ballsIn
  let place: { x: number; y: number } | undefined

  // ---- ball in hand: pick the best placement by sampling grid positions ----
  if (rules.ballInHand) {
    let best: { x: number; y: number; score: number } | null = null
    const n = cfg.placements
    const xs = n === 1 ? [PLAY_W / 4] : Array.from({ length: n }, (_, i) => 8 + ((PLAY_W - 16) * i) / (n - 1))
    const ys = [PLAY_H / 2, PLAY_H * 0.25, PLAY_H * 0.75]
    for (const x of xs) {
      for (const y of ys) {
        if (!canPlaceCue(ballsIn, x, y, rules.kitchenOnly)) continue
        const test = ballsIn.map((b) => (b.id === 0 ? { ...b, x, y } : b))
        const cands = aimCandidates(rules, test, difficulty === 'easy' ? 'easy' : 'medium')
        let bestScore = -Infinity
        for (const c of cands.slice(0, 40)) {
          const s = simulate(rules, test, c.angle, c.power, shooter)
          if (s > bestScore) bestScore = s
        }
        if (bestScore === -Infinity) bestScore = -500 // nowhere useful, still must place
        if (!best || bestScore > best.score) best = { x, y, score: bestScore }
      }
    }
    if (best) {
      place = { x: best.x, y: best.y }
      balls = ballsIn.map((b) => (b.id === 0 ? { ...b, x: best!.x, y: best!.y } : b))
    }
  }

  // ---- break shot: smash the rack ----
  if (rules.phase === 'break') {
    const cue = balls.find((b) => b.id === 0)!
    const apex = balls.find((b) => b.active && Math.abs(b.x - 150) < 20 && Math.abs(b.y - 50) < 20)
    const target = apex ?? balls.find((b) => b.active && b.id !== 0)!
    const angle = Math.atan2(target.y - cue.y, target.x - cue.x) + (rng() - 0.5) * 0.01
    return { angle, power: MAX_SHOT_SPEED, placeCue: place }
  }

  // ---- enumerate + simulate candidates ----
  const base = aimCandidates(rules, balls, difficulty)
  const candidates: Candidate[] = []
  for (const c of base) {
    const angle = c.angle + (rng() - 0.5) * 2 * cfg.jitter
    const score = simulate(rules, balls, angle, c.power, shooter)
    candidates.push({ angle, power: c.power, score })
  }
  candidates.sort((a, b) => b.score - a.score)

  if (candidates.length > 0) {
    const top = candidates.slice(0, Math.max(1, cfg.pickTop))
    const pick = top[Math.floor(rng() * top.length)]
    // avoid taking a suicidal shot when better defensive options exist: if the
    // best candidate is terrible, just tap the nearest legal ball (soft safety)
    if (pick.score > -300) {
      return { angle: pick.angle, power: pick.power, placeCue: place }
    }
  }

  // ---- fallback: soft hit toward nearest legal ball (safety) ----
  const cue = balls.find((b) => b.id === 0)!
  const myGroup = rules.groups[shooter]
  const legal = balls.filter((b) => {
    if (!b.active || b.id === 0) return false
    if (b.id === 8) return myGroup !== null && groupCleared(balls, myGroup)
    if (myGroup === null) return b.id !== 8
    return ballType(b.id) === myGroup
  })
  let angle: number
  if (legal.length > 0) {
    const nearest = legal.reduce((a, b) =>
      Math.hypot(b.x - cue.x, b.y - cue.y) < Math.hypot(a.x - cue.x, a.y - cue.y) ? b : a
    )
    angle = Math.atan2(nearest.y - cue.y, nearest.x - cue.x) + (rng() - 0.5) * 0.05
  } else {
    angle = rng() * Math.PI * 2
  }
  return { angle, power: MAX_SHOT_SPEED * 0.35, placeCue: place }
}

export const BOT_THINK_MS = (d: Difficulty) => DIFFICULTY_CFG[d].think

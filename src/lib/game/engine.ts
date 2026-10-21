// Game controller: owns balls + rules, runs shots, applies rules on settle.
import type {
  Ball,
  PlayerInfo,
  RulesState,
  ShotEvents,
} from './constants'
import { PhysicsSim, rackBalls } from './physics'
import { applyShot, canPlaceCue, initialRules } from './rules'

export interface ShotSettledInfo {
  events: ShotEvents
  rules: RulesState
  shooter: 0 | 1
  respottedEight: boolean
}

export interface SimCallbacks {
  onBallHit?: (speed: number, x: number, y: number) => void
  onCushion?: (speed: number, x: number, y: number) => void
  onPot?: (ballId: number, pocketIdx: number) => void
}

export interface BallLike {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  active: boolean
  sinking?: number
  sinkPocket?: number
}

export class PoolGame {
  balls: Ball[]
  rules: RulesState
  players: [PlayerInfo, PlayerInfo]
  sim: PhysicsSim | null = null
  simCallbacks: SimCallbacks = {}
  onShotSettled?: (info: ShotSettledInfo) => void

  constructor(players: [PlayerInfo, PlayerInfo], breaker: 0 | 1 = 0) {
    this.players = players
    this.balls = []
    this.rules = initialRules(breaker)
    this.rack(breaker)
  }

  rack(breaker: 0 | 1 = 0) {
    this.balls = rackBalls()
    this.rules = initialRules(breaker)
    this.sim = null
  }

  get simulating() {
    return this.sim !== null
  }

  get turn() {
    return this.rules.turn
  }

  canPlace(x: number, y: number) {
    if (this.simulating) return false
    return canPlaceCue(this.balls, x, y, this.rules.kitchenOnly)
  }

  placeCue(x: number, y: number) {
    if (!this.canPlace(x, y)) return false
    const cue = this.balls.find((b) => b.id === 0)
    if (!cue) return false
    cue.x = x
    cue.y = y
    cue.vx = 0
    cue.vy = 0
    cue.active = true
    cue.sinking = undefined
    cue.sinkPocket = undefined
    this.rules.ballInHand = false
    return true
  }

  shoot(angle: number, power: number) {
    if (this.simulating) return false
    const cue = this.balls.find((b) => b.id === 0)
    if (!cue || !cue.active) return false
    const speed = Math.max(60, Math.min(560, power))
    cue.vx = Math.cos(angle) * speed
    cue.vy = Math.sin(angle) * speed
    const sim = new PhysicsSim(this.balls)
    sim.onBallHit = this.simCallbacks.onBallHit
    sim.onCushion = this.simCallbacks.onCushion
    sim.onPot = this.simCallbacks.onPot
    this.sim = sim
    return true
  }

  /** Advance the active simulation; applies rules when all balls settle. */
  step(dt: number) {
    if (!this.sim) return
    this.sim.step(dt)
    // Publish live positions every frame so the renderer shows balls actually
    // moving during the shot (this.balls aliases the sim's live ball array).
    this.balls = this.sim.balls
    if (this.sim.done) {
      const sim = this.sim
      const ev = sim.events()
      const shooter = this.rules.turn
      const outcome = applyShot(this.rules, this.balls, ev)
      this.rules = outcome.next
      // ball in hand: hide the cue ball until the incoming player places it
      if (this.rules.ballInHand && this.rules.phase !== 'over') {
        const cue = this.balls.find((b) => b.id === 0)
        if (cue) cue.active = false
      }
      this.sim = null
      this.onShotSettled?.({
        events: ev,
        rules: this.rules,
        shooter,
        respottedEight: outcome.respottedEight,
      })
    }
  }

  /** Hard-overwrite state (used by the online guest when the host syncs). */
  applySync(balls: BallLike[], rules: RulesState) {
    this.sim = null
    this.balls = balls.map((b) => ({ ...b }))
    this.rules = { ...rules }
  }

  /** State snapshot to send over the wire. */
  snapshot() {
    return { balls: this.balls.map((b) => ({ ...b })), rules: { ...this.rules } }
  }
}

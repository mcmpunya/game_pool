import {
  BALL_R,
  BALL_RESTITUTION,
  CORNER_MOUTH,
  CUSHION_RESTITUTION,
  CUSHIONS,
  DT,
  FRICTION_DECEL,
  MAX_SIM_TIME,
  PLAY_H,
  PLAY_W,
  POCKETS,
  POCKET_PULL,
  SIDE_MOUTH,
  STOP_SPEED,
  type Ball,
  type ShotEvents,
} from './constants'

const TWO_R = BALL_R * 2

export function cloneBalls(balls: Ball[]): Ball[] {
  return balls.map((b) => ({ ...b }))
}

/** Initial 8-ball rack. Cue ball on head spot, apex ball on foot spot. */
export function rackBalls(): Ball[] {
  const balls: Ball[] = [
    { id: 0, x: 50, y: 50, vx: 0, vy: 0, active: true },
  ]
  const rows = [
    [1],
    [9, 2],
    [3, 8, 10],
    [11, 4, 12, 5],
    [6, 13, 14, 7, 15],
  ]
  const dx = TWO_R * 0.87
  const dy = TWO_R + 0.06
  const footX = 150
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      balls.push({
        id: rows[i][j],
        x: footX + i * dx + (Math.random() - 0.5) * 0.08,
        y: 50 + (j - i / 2) * dy + (Math.random() - 0.5) * 0.08,
        vx: 0,
        vy: 0,
        active: true,
      })
    }
  }
  return balls
}

/** Re-spot a ball (8-ball after break pot) at foot spot or first free spot behind it. */
export function respotBall(balls: Ball[], id: number) {
  const ball = balls.find((b) => b.id === id)
  if (!ball) return
  ball.active = true
  ball.sinking = undefined
  ball.sinkPocket = undefined
  ball.vx = 0
  ball.vy = 0
  let x = 150
  const y = 50
  for (let tries = 0; tries < 40; tries++) {
    const clash = balls.some(
      (b) => b.active && b.id !== id && Math.hypot(b.x - x, b.y - y) < TWO_R + 0.2
    )
    if (!clash) break
    x += 2 // nudge toward foot rail
    if (x > PLAY_W - BALL_R) x = 150 - tries * 2
  }
  ball.x = x
  ball.y = y
}

function reflect(ball: Ball, nx: number, ny: number, restitution: number) {
  const dot = ball.vx * nx + ball.vy * ny
  if (dot >= 0) return false
  ball.vx -= (1 + restitution) * dot * nx
  ball.vy -= (1 + restitution) * dot * ny
  return true
}

/**
 * Incremental physics simulation of one shot. Step with fixed dt inside a RAF loop,
 * or run to completion headlessly via runToEnd().
 */
export class PhysicsSim {
  balls: Ball[]
  time = 0
  private finished = false
  private firstContact: number | null = null
  private contactMade = false
  private railHits = 0
  private pottedList: number[] = []
  private cuePotted = false

  onBallHit?: (speed: number, x: number, y: number) => void
  onCushion?: (speed: number, x: number, y: number) => void
  onPot?: (ballId: number, pocketIdx: number) => void

  constructor(balls: Ball[]) {
    this.balls = cloneBalls(balls)
  }

  get done() {
    return this.finished
  }

  step(dt: number) {
    if (this.finished) return
    this.time += dt
    if (this.time > MAX_SIM_TIME) {
      this.finish()
      return
    }

    const balls = this.balls
    // integrate with velocity-dependent substeps to avoid tunnelling
    for (const ball of balls) {
      if (!ball.active) continue
      const speed = Math.hypot(ball.vx, ball.vy)
      if (speed <= 0) continue
      const steps = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.45)))
      const sdt = dt / steps
      for (let s = 0; s < steps; s++) {
        if (!ball.active) break
        ball.x += ball.vx * sdt
        ball.y += ball.vy * sdt
        // friction
        const sp = Math.hypot(ball.vx, ball.vy)
        if (sp > 0) {
          const ns = sp - FRICTION_DECEL * sdt
          if (ns <= STOP_SPEED) {
            ball.vx = 0
            ball.vy = 0
          } else {
            const k = ns / sp
            ball.vx *= k
            ball.vy *= k
          }
        }
        this.pocketCheck(ball, sdt)
        if (ball.active) this.cushionCheck(ball)
      }
    }

    // ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]
      if (!a.active) continue
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]
        if (!b.active) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 > TWO_R * TWO_R || d2 === 0) continue
        const d = Math.sqrt(d2)
        const nx = dx / d
        const ny = dy / d
        // separate overlap
        const overlap = TWO_R - d
        a.x -= nx * overlap * 0.5
        a.y -= ny * overlap * 0.5
        b.x += nx * overlap * 0.5
        b.y += ny * overlap * 0.5
        const rvx = b.vx - a.vx
        const rvy = b.vy - a.vy
        const rel = rvx * nx + rvy * ny
        if (rel < 0) {
          const impulse = -(1 + BALL_RESTITUTION) * rel * 0.5
          a.vx -= impulse * nx
          a.vy -= impulse * ny
          b.vx += impulse * nx
          b.vy += impulse * ny
          const impact = Math.abs(rel)
          if (impact > 8) this.onBallHit?.(impact, (a.x + b.x) / 2, (a.y + b.y) / 2)
        }
        if (this.firstContact === null) {
          if (a.id === 0) this.firstContact = b.id
          else if (b.id === 0) this.firstContact = a.id
        }
        this.contactMade = true
      }
    }

    // finished when everything is at rest
    let moving = false
    for (const ball of balls) {
      if (ball.active && (ball.vx !== 0 || ball.vy !== 0)) {
        moving = true
        break
      }
    }
    if (!moving) this.finish()
  }

  private pot(ball: Ball, p: number) {
    ball.active = false
    ball.vx = 0
    ball.vy = 0
    ball.sinking = 0
    ball.sinkPocket = p
    if (ball.id === 0) this.cuePotted = true
    else this.pottedList.push(ball.id)
    this.onPot?.(ball.id, p)
  }

  private pocketCheck(ball: Ball, sdt: number) {
    const speed = Math.hypot(ball.vx, ball.vy)
    for (let p = 0; p < POCKETS.length; p++) {
      const pk = POCKETS[p]
      const dx = ball.x - pk.x
      const dy = ball.y - pk.y
      const dist = Math.hypot(dx, dy)

      // 1) Potted as soon as the ball's CENTRE crosses the drawn hole rim.
      // 2) A slow ball teetering on the lip (within 0.4 * BALL_R of the rim)
      //    topples in rather than stopping on the pocket edge.
      if (dist < pk.r || (dist < pk.r + BALL_R * 0.4 && speed < 65)) {
        this.pot(ball, p)
        return
      }

      // 3) Funnel: gentle pull toward the hole while the ball is over the
      //    pocket MOUTH (rail gap), bending slow near-miss paths in instead
      //    of rattling them out. Negligible at break speeds, decisive for
      //    slow rolls. Sector-gated so balls rolling past on the felt are
      //    not visibly curved toward the hole.
      const pullR = pk.r + BALL_R
      const inMouth = pk.corner
        ? (pk.x === 0 ? ball.x < CORNER_MOUTH : ball.x > PLAY_W - CORNER_MOUTH) &&
          (pk.y === 0 ? ball.y < CORNER_MOUTH : ball.y > PLAY_H - CORNER_MOUTH)
        : Math.abs(ball.x - pk.x) < SIDE_MOUTH
      if (inMouth && dist < pullR) {
        const k = 1 - dist / pullR
        const a = POCKET_PULL * k * k
        ball.vx -= (dx / dist) * a * sdt
        ball.vy -= (dy / dist) * a * sdt
      }
    }

    // 4) Committed: centre crossed the rail line inside a pocket mouth.
    //    On a real table the ball is over the drop at this point — pot it
    //    into the nearest hole instead of bouncing off an invisible wall.
    if (ball.x < 0 || ball.x > PLAY_W || ball.y < 0 || ball.y > PLAY_H) {
      let best = 0
      let bd = Infinity
      for (let p = 0; p < POCKETS.length; p++) {
        const pk = POCKETS[p]
        const d = Math.hypot(ball.x - pk.x, ball.y - pk.y)
        if (d < bd) {
          bd = d
          best = p
        }
      }
      this.pot(ball, best)
    }
  }

  private cushionCheck(ball: Ball) {
    for (const seg of CUSHIONS) {
      // closest point on segment
      const ex = seg.x2 - seg.x1
      const ey = seg.y2 - seg.y1
      const len2 = ex * ex + ey * ey
      let t = ((ball.x - seg.x1) * ex + (ball.y - seg.y1) * ey) / len2
      t = Math.max(0, Math.min(1, t))
      const cx = seg.x1 + ex * t
      const cy = seg.y1 + ey * t
      const dx = ball.x - cx
      const dy = ball.y - cy
      const d2 = dx * dx + dy * dy
      if (d2 >= BALL_R * BALL_R || d2 === 0) continue
      const d = Math.sqrt(d2)
      const nx = dx / d
      const ny = dy / d
      // push out
      ball.x = cx + nx * BALL_R
      ball.y = cy + ny * BALL_R
      const speed = Math.hypot(ball.vx, ball.vy)
      if (reflect(ball, nx, ny, CUSHION_RESTITUTION)) {
        // slight tangential damping
        ball.vx *= 0.985
        ball.vy *= 0.985
        if (speed > 20) {
          this.railHits++
          this.onCushion?.(speed, cx, cy)
        }
      }
    }
  }

  private finish() {
    this.finished = true
  }

  events(): ShotEvents {
    return {
      firstContact: this.firstContact,
      potted: [...this.pottedList],
      cuePotted: this.cuePotted,
      anyRailAfterContact: this.railHits > 0,
      duration: this.time,
    }
  }

  runToEnd() {
    while (!this.finished) this.step(DT)
  }
}

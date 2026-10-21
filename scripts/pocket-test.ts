// Headless pocket-capture test: fires balls at every pocket from many
// angles/speeds and reports potted vs bounced-out. Run: bun scripts/pocket-test.ts
import { PhysicsSim } from '../src/lib/game/physics'
import { BALL_R, POCKETS, type Ball } from '../src/lib/game/constants'

function mkBall(x: number, y: number, vx: number, vy: number): Ball {
  return { id: 1, x, y, vx, vy, active: true }
}

function runShot(b: Ball): { potted: boolean; end: Ball } {
  const sim = new PhysicsSim([mkBall(0, 0, 0, 0), b]) // spare cue ball far away? no—id0 needed
  // NOTE: PhysicsSim expects a cue ball for events but potting works regardless.
  const test = sim.balls[1]
  sim.runToEnd()
  return { potted: !test.active, end: test }
}

let pass = 0
let fail = 0
const failures: string[] = []

const speeds = [80, 200, 420]

// --- Case 1: shallow-angle rail rolls past each pocket (the reported bug) ---
// ball rolls parallel to the rail, offset d from it, aimed across the pocket
for (const pk of POCKETS) {
  for (const d of [5.5, 7, 8.5]) {
    for (const sp of speeds) {
      // approach horizontally for top/bottom pockets, vertically for side rails
      const horiz = pk.y <= 0.5 || pk.y >= 99.5
      const dirSign = pk.x > 100 || (pk.y >= 99.5 && pk.x <= 100) ? -1 : 1
      let b: Ball
      if (horiz) {
        const x = pk.x - dirSign * 40
        b = mkBall(x, d, dirSign * sp, 0)
      } else {
        const y = pk.y > 50 ? pk.y - 40 : pk.y + 40
        b = mkBall(d, y, 0, pk.y > 50 ? -sp : sp)
      }
      const { potted, end } = runShot(b)
      // a ball whose centre overlaps the drawn hole MUST drop
      const minDist = horiz ? Math.abs(d - pk.y) : Math.abs(d - pk.x)
      const overlap = minDist < pk.r - BALL_R // ball edge crosses hole centre line
      const label = `pocket(${pk.x},${pk.y}) d=${d} sp=${sp}`
      if (overlap && !potted) {
        fail++
        failures.push(`MISS visual-overlap: ${label} ended at (${end.x.toFixed(1)},${end.y.toFixed(1)})`)
      } else if (potted) {
        pass++
      } else {
        pass++ // grazed without overlapping the hole — legal miss
      }
    }
  }
}

// --- Case 2: straight-in shots at every pocket must always pot ---
for (const pk of POCKETS) {
  for (const off of [-4, 0, 4]) {
    for (const sp of speeds) {
      let b: Ball
      if (pk.corner) {
        // approach along the diagonal toward the corner
        const sx = pk.x === 0 ? 30 : 170
        const sy = pk.y === 0 ? 15 : 85
        b = mkBall(sx, sy, (pk.x - sx) * 4, (pk.y - sy) * 4)
        const n = Math.hypot(b.vx, b.vy)
        b.vx = (b.vx / n) * sp
        b.vy = (b.vy / n) * sp
      } else {
        const y = pk.y > 50 ? pk.y + 25 : pk.y - 25
        b = mkBall(pk.x + off, y, 0, pk.y > 50 ? -sp : sp)
      }
      const { potted, end } = runShot(b)
      const label = `pocket(${pk.x},${pk.y}) off=${off} sp=${sp}`
      if (!potted) {
        fail++
        failures.push(`MISS straight-in: ${label} ended at (${end.x.toFixed(1)},${end.y.toFixed(1)})`)
      } else {
        pass++
      }
    }
  }
}

console.log(`PASS ${pass}, FAIL ${fail}`)
for (const f of failures) console.log('  ' + f)
if (fail > 0) process.exit(1)

// Headless verification of pocket capture behaviour ("ball hit the hole but not in" fix)
import { PhysicsSim } from '../src/lib/game/physics'
import { BALL_R, MAX_SHOT_SPEED, POCKETS, type Ball } from '../src/lib/game/constants'

let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${detail}`)
  }
}

function mk(id: number, x: number, y: number, vx: number, vy: number): Ball {
  return { id, x, y, vx, vy, active: true }
}

function run(balls: Ball[]) {
  const sim = new PhysicsSim(balls)
  sim.runToEnd()
  return sim.balls // sim clones internally — read the clone, not the input
}

console.log('— corner pocket: rail roll (centre y = 4.4) —')
{
  const out = run([mk(1, 30, BALL_R, -120, 0)])
  check('1-ball potted into top-left corner', !out[0].active)
}

console.log('— corner pocket: slow ball stops on the lip → topples in —')
{
  // stops ~11.5 units from pocket centre: inside lip zone, outside rim
  const out = run([mk(1, 9.55, 9.55, -8.4, -8.4)])
  check('slow lip ball potted', !out[0].active, `active=${out[0].active} pos=${out[0].x.toFixed(1)},${out[0].y.toFixed(1)}`)
}

console.log('— side pocket: straight-in —')
{
  const out = run([mk(1, 100, 60, 0, -200)])
  check('potted into top side pocket', !out[0].active)
}

console.log('— corner mouth edge: fast ball crosses rail line beside hole centre —')
{
  const out = run([mk(1, 10.5, 30, 0, -150)])
  check('committed ball potted', !out[0].active)
}

console.log('— mid-speed ball rolling past the side pocket (off-hole) stays on table —')
{
  // y=14: outside corner mouths and outside the side-pocket pull radius,
  // bounces off the left cushion and comes to rest on the felt
  const out = run([mk(1, 130, 14, -120, 0)])
  check('near-miss ball stays active', out[0].active, `potted? active=${out[0].active}`)
  check('near-miss ball still inside bounds', out[0].x > 0 && out[0].x < 200 && out[0].y > 0 && out[0].y < 100)
}

console.log('— fast ball passing pocket at distance is unaffected —')
{
  const out = run([mk(1, 130, 20, -150, 0)])
  check('ball keeps rolling (not sucked in)', out[0].active)
}

console.log('— full break at max power: no escapes, sim terminates —')
{
  const sim = new PhysicsSim([
    { id: 0, x: 50, y: 50, vx: 0, vy: 0, active: true },
    { id: 1, x: 150, y: 50, vx: 0, vy: 0, active: true },
    { id: 2, x: 150 + 7.7, y: 46.2, vx: 0, vy: 0, active: true },
    { id: 3, x: 150 + 7.7, y: 53.8, vx: 0, vy: 0, active: true },
    { id: 8, x: 150 + 15.4, y: 50, vx: 0, vy: 0, active: true },
    { id: 9, x: 150 + 15.4, y: 42.4, vx: 0, vy: 0, active: true },
    { id: 10, x: 150 + 15.4, y: 57.6, vx: 0, vy: 0, active: true },
  ])
  const potted: number[] = []
  sim.onPot = (id) => potted.push(id)
  // fire first, then run — a step with everything at rest would finish the sim
  sim.balls[0].vx = MAX_SHOT_SPEED
  sim.balls[0].vy = (Math.random() - 0.5) * 4
  sim.runToEnd()
  const escaped = sim.balls.filter(
    (b) => b.active && (b.x < 0 || b.x > 200 || b.y < 0 || b.y > 100)
  )
  check('no active ball escaped the table', escaped.length === 0)
  check('simulation reached rest', sim.done, `time=${sim.time.toFixed(1)}`)
  console.log(`    (potted on break: [${potted.join(', ')}], sim time ${sim.time.toFixed(2)}s)`)
}

console.log('— all 6 pockets reachable: aimed shots drop —')
{
  // each shot fired straight at the pocket centre
  const shots: [number, number, number, number, number][] = [
    [80, 35, 0, 0, 220],     // → top-left corner (0,0)
    [120, 35, 200, 0, 220],  // → top-right corner (200,0)
    [80, 65, 0, 100, 220],   // → bottom-left corner (0,100)
    [120, 65, 200, 100, 220],// → bottom-right corner (200,100)
    [100, 70, 100, -1.2, 200], // → top side
    [100, 30, 100, 101.2, 200],// → bottom side
  ]
  for (const [x, y, tx, ty, sp] of shots) {
    const dx = tx - x
    const dy = ty - y
    const d = Math.hypot(dx, dy)
    const out = run([mk(1, x, y, (dx / d) * sp, (dy / d) * sp)])
    check(`shot (${x},${y}) → pocket (${tx},${ty}) pots`, !out[0].active)
  }
  void POCKETS
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)

// Reproduce the exact browser shot: cue at (29.2,74.4), angle 138.7deg, 35% power
import { PhysicsSim } from '../src/lib/game/physics'
import { MAX_SHOT_SPEED } from '../src/lib/game/constants'

const angle = Math.atan2(13.03, -14.85)
const speed = 0.36 * MAX_SHOT_SPEED
console.log('angle deg =', ((angle * 180) / Math.PI).toFixed(1), 'speed =', speed.toFixed(0))

const sim = new PhysicsSim([{ id: 0, x: 29.2, y: 74.4, vx: 0, vy: 0, active: true }])
sim.balls[0].vx = Math.cos(angle) * speed
sim.balls[0].vy = Math.sin(angle) * speed
sim.runToEnd()
const b = sim.balls[0]
console.log('cue end:', { x: b.x.toFixed(1), y: b.y.toFixed(1), active: b.active, sinking: b.sinking })
console.log('events:', sim.events())

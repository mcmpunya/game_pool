// Canvas renderer for the pool table. Table-space: 230 x 130 (play 200x100 + 15 rails).
import {
  BALL_R,
  BALL_COLORS,
  CUSHIONS,
  PLAY_H,
  PLAY_W,
  POCKETS,
  RAIL,
  TABLE_H,
  TABLE_W,
  type Ball,
} from './constants'
import { canPlaceCue } from './rules'

export interface View {
  scale: number
  ox: number
  oy: number
}

export function computeView(cssW: number, cssH: number): View {
  const scale = Math.min(cssW / TABLE_W, cssH / TABLE_H)
  return {
    scale,
    ox: (cssW - TABLE_W * scale) / 2,
    oy: (cssH - TABLE_H * scale) / 2,
  }
}

export function tableToScreen(v: View, x: number, y: number): [number, number] {
  // x,y are PLAY coords; the canvas draws furniture at RAIL + play
  return [v.ox + (x + RAIL) * v.scale, v.oy + (y + RAIL) * v.scale]
}

export function screenToTable(v: View, sx: number, sy: number): [number, number] {
  // Returns PLAY coords (0..PLAY_W, 0..PLAY_H) to match the physics/rules
  // frame. Previously the RAIL offset was omitted here AND in the ball
  // drawing, which shifted the whole ball layer 15 units up-left of the
  // rendered pockets/cushions — balls rolled into the visible hole where
  // no physics pocket existed and bounced back out.
  return [(sx - v.ox) / v.scale - RAIL, (sy - v.oy) / v.scale - RAIL]
}

// ---------- aim prediction ----------

export interface AimPrediction {
  dir: { x: number; y: number }
  ghost: { x: number; y: number }
  dist: number
  targetId: number | null
  targetDir: { x: number; y: number } | null
  cueDeflect: { x: number; y: number } | null
  bounce: { from: { x: number; y: number }; to: { x: number; y: number } } | null
}

const TWO_R = BALL_R * 2

/** Analytic ray cast: first ball hit or one cushion bounce preview. */
export function predictAim(balls: Ball[], angle: number): AimPrediction {
  const cue = balls.find((b) => b.id === 0)
  if (!cue) throw new Error('no cue ball')
  const d = { x: Math.cos(angle), y: Math.sin(angle) }
  let bestT = Infinity
  let target: Ball | null = null
  for (const b of balls) {
    if (!b.active || b.id === 0) continue
    const ex = b.x - cue.x
    const ey = b.y - cue.y
    const proj = ex * d.x + ey * d.y
    if (proj <= 0) continue
    const perp2 = ex * ex + ey * ey - proj * proj
    const R2 = TWO_R * TWO_R
    if (perp2 > R2) continue
    const t = proj - Math.sqrt(R2 - perp2)
    if (t > 0.0001 && t < bestT) {
      bestT = t
      target = b
    }
  }

  if (target) {
    const ghost = { x: cue.x + d.x * bestT, y: cue.y + d.y * bestT }
    const tdx = target.x - ghost.x
    const tdy = target.y - ghost.y
    const tl = Math.hypot(tdx, tdy) || 1
    const targetDir = { x: tdx / tl, y: tdy / tl }
    const dot = d.x * targetDir.x + d.y * targetDir.y
    let cx = d.x - dot * targetDir.x
    let cy = d.y - dot * targetDir.y
    const cl = Math.hypot(cx, cy)
    if (cl > 0.02) {
      cx /= cl
      cy /= cl
    } else {
      cx = 0
      cy = 0
    }
    return {
      dir: d,
      ghost,
      dist: bestT,
      targetId: target.id,
      targetDir,
      cueDeflect: { x: cx, y: cy },
      bounce: null,
    }
  }

  // no ball hit: preview one cushion bounce on the inner rail lines
  const bx = BALL_R
  const by = BALL_R
  const walls: { axis: 'x' | 'y'; pos: number; sign: 1 | -1 }[] = [
    { axis: 'y', pos: by, sign: -1 },
    { axis: 'y', pos: PLAY_H - by, sign: 1 },
    { axis: 'x', pos: bx, sign: -1 },
    { axis: 'x', pos: PLAY_W - bx, sign: 1 },
  ]
  let wallT = Infinity
  let hitWall: (typeof walls)[number] | null = null
  for (const w of walls) {
    const dn = w.axis === 'x' ? d.x : d.y
    const on = w.axis === 'x' ? cue.x : cue.y
    if (Math.abs(dn) < 1e-6) continue
    const t = (w.pos - on) / dn
    if (t > 0.001 && t < wallT) {
      wallT = t
      hitWall = w
    }
  }
  if (hitWall && wallT < 800) {
    const hx = cue.x + d.x * wallT
    const hy = cue.y + d.y * wallT
    const rx = hitWall.axis === 'x' ? -d.x : d.x
    const ry = hitWall.axis === 'y' ? -d.y : d.y
    const len = Math.min(30, wallT * 0.6)
    return {
      dir: d,
      ghost: { x: hx, y: hy },
      dist: wallT,
      targetId: null,
      targetDir: null,
      cueDeflect: null,
      bounce: { from: { x: hx, y: hy }, to: { x: hx + rx * len, y: hy + ry * len } },
    }
  }

  return {
    dir: d,
    ghost: { x: cue.x + d.x * 200, y: cue.y + d.y * 200 },
    dist: 200,
    targetId: null,
    targetDir: null,
    cueDeflect: null,
    bounce: null,
  }
}

// ---------- drawing ----------

export interface DrawOpts {
  balls: Ball[]
  view: View
  ctx: CanvasRenderingContext2D
  time: number
  dpr: number
  cssW: number
  cssH: number
  aim?: { angle: number; power: number } | null
  ballInHand?: { active: boolean; x: number; y: number; legal: boolean }
  cueGlow?: boolean
  breakerGlow?: boolean
  /** Real cue stick: aimed along `angle`, pulled back by `power`, optional strike lunge 0..1 */
  cueStick?: { angle: number; power: number; strike?: number } | null
  /** Vertical power gauge on the right rail; null/undefined = hidden */
  powerGauge?: number | null
}

export function draw(ctx: CanvasRenderingContext2D, o: DrawOpts) {
  const { ctx: c, view: v, time, dpr } = o
  c.save()
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, o.cssW, o.cssH)
  c.scale(v.scale, v.scale)
  c.translate(v.ox / v.scale, v.oy / v.scale)

  drawFrame(c, time)
  drawFelt(c)
  drawPockets(c)
  drawSights(c)
  drawCushions(c)

  // Everything from here on lives in PLAY coords (balls, pockets, cushions in
  // the physics all use 0..PLAY_W / 0..PLAY_H). Furniture above was drawn at
  // RAIL + play, so shift the play layer to line up with it.
  c.translate(RAIL, RAIL)

  // aim guide under balls
  if (o.aim) drawAimGuide(c, o)

  for (const b of o.balls) {
    if (!b.active && b.sinking === undefined) continue
    if (b.sinking !== undefined) drawSinking(c, b, o)
    else drawBall(c, b, time)
  }

  if (o.cueStick) drawCueStick(c, o)

  if (o.powerGauge !== null && o.powerGauge !== undefined) drawPowerGauge(c, o.powerGauge)

  if (o.ballInHand?.active) {
    const { x, y, legal } = o.ballInHand
    c.globalAlpha = 0.55
    const fake = { id: 0, x, y, vx: 0, vy: 0, active: true }
    drawBall(c, fake, time)
    c.globalAlpha = 1
    if (!legal) {
      c.strokeStyle = '#ff5a5a'
      c.lineWidth = 1.6
      const r = BALL_R * 0.75
      c.beginPath()
      c.moveTo(x - r, y - r)
      c.lineTo(x + r, y + r)
      c.moveTo(x + r, y - r)
      c.lineTo(x - r, y + r)
      c.stroke()
    }
  }

  if (o.cueGlow) {
    const cue = o.balls.find((b) => b.id === 0 && b.active)
    if (cue) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4)
      c.beginPath()
      c.arc(cue.x, cue.y, BALL_R + 2.2 + pulse * 1.2, 0, Math.PI * 2)
      c.strokeStyle = `rgba(255, 255, 255, ${0.35 + pulse * 0.3})`
      c.lineWidth = 0.9
      c.stroke()
    }
  }

  c.restore()
}

function drawFrame(c: CanvasRenderingContext2D, time: number) {
  const grad = c.createLinearGradient(0, 0, 0, TABLE_H)
  grad.addColorStop(0, '#6b4423')
  grad.addColorStop(0.5, '#4a2d14')
  grad.addColorStop(1, '#3a2210')
  c.fillStyle = grad
  roundRect(c, 0, 0, TABLE_W, TABLE_H, 6)
  c.fill()
  c.strokeStyle = 'rgba(0,0,0,0.5)'
  c.lineWidth = 0.8
  roundRect(c, 1, 1, TABLE_W - 2, TABLE_H - 2, 5.5)
  c.stroke()
  // inner rail shadow
  c.strokeStyle = 'rgba(0,0,0,0.35)'
  c.lineWidth = 2
  roundRect(c, RAIL - 2.5, RAIL - 2.5, PLAY_W + 5, PLAY_H + 5, 3)
  c.stroke()
}

function drawFelt(c: CanvasRenderingContext2D) {
  const grad = c.createRadialGradient(TABLE_W / 2, TABLE_H / 2, 10, TABLE_W / 2, TABLE_H / 2, TABLE_W / 1.4)
  grad.addColorStop(0, '#1e8a52')
  grad.addColorStop(0.7, '#176b40')
  grad.addColorStop(1, '#0f5230')
  c.fillStyle = grad
  c.fillRect(RAIL - 4, RAIL - 4, PLAY_W + 8, PLAY_H + 8)
  // subtle cloth noise lines
  c.strokeStyle = 'rgba(0,0,0,0.045)'
  c.lineWidth = 0.4
  for (let x = RAIL; x < RAIL + PLAY_W; x += 4) {
    c.beginPath()
    c.moveTo(x, RAIL)
    c.lineTo(x, RAIL + PLAY_H)
    c.stroke()
  }
  // head string line (kitchen) + spots
  c.strokeStyle = 'rgba(255,255,255,0.10)'
  c.lineWidth = 0.5
  c.beginPath()
  c.moveTo(RAIL + PLAY_W / 4, RAIL)
  c.lineTo(RAIL + PLAY_W / 4, RAIL + PLAY_H)
  c.stroke()
  for (const sx of [PLAY_W / 4, PLAY_W / 2, (3 * PLAY_W) / 4]) {
    c.fillStyle = 'rgba(255,255,255,0.14)'
    c.beginPath()
    c.arc(RAIL + sx, RAIL + PLAY_H / 2, 0.8, 0, Math.PI * 2)
    c.fill()
  }
}

function drawPockets(c: CanvasRenderingContext2D) {
  for (const p of POCKETS) {
    const x = RAIL + p.x
    const y = RAIL + p.y
    const grad = c.createRadialGradient(x, y, p.r * 0.2, x, y, p.r)
    grad.addColorStop(0, '#000000')
    grad.addColorStop(0.8, '#0a0a0a')
    grad.addColorStop(1, '#1c1c1c')
    c.fillStyle = grad
    c.beginPath()
    c.arc(x, y, p.r, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = 'rgba(255,215,120,0.18)'
    c.lineWidth = 0.7
    c.stroke()
  }
}

function drawSights(c: CanvasRenderingContext2D) {
  c.fillStyle = 'rgba(255,240,200,0.5)'
  const positions: [number, number][] = []
  for (let i = 1; i <= 7; i++) {
    if (i !== 4) {
      positions.push([RAIL + (PLAY_W * i) / 8, RAIL / 2])
      positions.push([RAIL + (PLAY_W * i) / 8, RAIL + PLAY_H + RAIL / 2])
    }
  }
  for (let i = 1; i <= 3; i++) {
    positions.push([RAIL / 2, RAIL + (PLAY_H * i) / 4])
    positions.push([RAIL + PLAY_W + RAIL / 2, RAIL + (PLAY_H * i) / 4])
  }
  for (const [x, y] of positions) {
    c.save()
    c.translate(x, y)
    c.rotate(Math.PI / 4)
    c.fillRect(-0.9, -0.9, 1.8, 1.8)
    c.restore()
  }
}

function drawCushions(c: CanvasRenderingContext2D) {
  c.fillStyle = 'rgba(10, 60, 35, 0.55)'
  for (const seg of CUSHIONS) {
    const x1 = RAIL + seg.x1
    const y1 = RAIL + seg.y1
    const x2 = RAIL + seg.x2
    const y2 = RAIL + seg.y2
    const horizontal = Math.abs(y1 - y2) < 0.01
    c.beginPath()
    if (horizontal) {
      const sign = y1 < TABLE_H / 2 ? -1 : 1
      c.moveTo(x1, y1)
      c.lineTo(x2, y2)
      c.lineTo(x2, y2 + sign * 3.2)
      c.lineTo(x1, y1 + sign * 3.2)
    } else {
      const sign = x1 < TABLE_W / 2 ? -1 : 1
      c.moveTo(x1, y1)
      c.lineTo(x2, y2)
      c.lineTo(x2 + sign * 3.2, y2)
      c.lineTo(x1 + sign * 3.2, y1)
    }
    c.closePath()
    c.fill()
  }
}

function drawAimGuide(c: CanvasRenderingContext2D, o: DrawOpts) {
  const { balls, aim } = o
  if (!aim) return
  const cue = balls.find((b) => b.id === 0)
  if (!cue || !cue.active) return
  const p = predictAim(balls, aim.angle)

  c.save()
  c.setLineDash([2.2, 2.6])
  c.lineWidth = 0.65
  c.strokeStyle = 'rgba(255,255,255,0.75)'
  c.beginPath()
  c.moveTo(cue.x, cue.y)
  c.lineTo(p.ghost.x, p.ghost.y)
  c.stroke()

  // ghost ball
  c.setLineDash([])
  c.beginPath()
  c.arc(p.ghost.x, p.ghost.y, BALL_R, 0, Math.PI * 2)
  c.strokeStyle = 'rgba(255,255,255,0.55)'
  c.stroke()

  if (p.targetDir && p.targetId !== null) {
    const t = balls.find((b) => b.id === p.targetId)
    if (t) {
      c.beginPath()
      c.moveTo(t.x, t.y)
      c.lineTo(t.x + p.targetDir.x * 24, t.y + p.targetDir.y * 24)
      c.strokeStyle = 'rgba(255,220,120,0.8)'
      c.stroke()
    }
  }
  if (p.cueDeflect) {
    c.beginPath()
    c.moveTo(p.ghost.x, p.ghost.y)
    c.lineTo(p.ghost.x + p.cueDeflect.x * 12, p.ghost.y + p.cueDeflect.y * 12)
    c.strokeStyle = 'rgba(160,220,255,0.65)'
    c.stroke()
  }
  if (p.bounce) {
    c.setLineDash([1.8, 2.2])
    c.beginPath()
    c.moveTo(p.bounce.from.x, p.bounce.from.y)
    c.lineTo(p.bounce.to.x, p.bounce.to.y)
    c.strokeStyle = 'rgba(255,255,255,0.4)'
    c.stroke()
  }

  // pull-back elastic band + power arc at the cue ball
  const pow = aim.power
  if (pow > 0.001) {
    const bx = cue.x - p.dir.x * (5 + pow * 10)
    const by = cue.y - p.dir.y * (5 + pow * 10)
    c.setLineDash([])
    c.lineWidth = 1.6
    c.strokeStyle = `rgba(${Math.round(90 + pow * 165)}, ${Math.round(210 - pow * 160)}, 90, 0.9)`
    c.beginPath()
    c.moveTo(cue.x, cue.y)
    c.lineTo(bx, by)
    c.stroke()
    c.beginPath()
    c.arc(bx, by, 1.6, 0, Math.PI * 2)
    c.fillStyle = c.strokeStyle
    c.fill()
  }
  c.restore()
}

// ---------- power gauge ----------

/** Vertical POWER bar over the right rail (PLAY coords): fills bottom->top, green -> amber -> red. */
function drawPowerGauge(c: CanvasRenderingContext2D, power: number) {
  const p = Math.max(0, Math.min(1, power))
  const w = 3.6
  const h = 46
  const x = PLAY_W - w - 3.2
  const yTop = (PLAY_H - h) / 2

  c.save()

  // track
  c.fillStyle = 'rgba(0,0,0,0.42)'
  roundRect(c, x, yTop, w, h, w / 2)
  c.fill()
  c.strokeStyle = 'rgba(255,255,255,0.4)'
  c.lineWidth = 0.45
  c.stroke()

  // fill (fixed gradient across the whole track so colour = level)
  const fh = p * (h - 1.2)
  if (fh > 0.4) {
    const grad = c.createLinearGradient(0, yTop + h, 0, yTop)
    grad.addColorStop(0, '#4ade80')
    grad.addColorStop(0.55, '#facc15')
    grad.addColorStop(1, '#ef4444')
    c.fillStyle = grad
    roundRect(c, x + 0.6, yTop + h - 0.6 - fh, w - 1.2, fh, (w - 1.2) / 2)
    c.fill()
  }

  // tick marks at 25/50/75%
  c.strokeStyle = 'rgba(255,255,255,0.5)'
  c.lineWidth = 0.35
  for (const t of [0.25, 0.5, 0.75]) {
    const ty = yTop + h - t * h
    c.beginPath()
    c.moveTo(x - 0.9, ty)
    c.lineTo(x, ty)
    c.stroke()
  }

  // label
  c.fillStyle = 'rgba(255,255,255,0.95)'
  c.font = 'bold 4.4px system-ui, sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(`${Math.round(p * 100)}%`, x + w / 2, yTop - 3.4)
  c.font = 'bold 3.2px system-ui, sans-serif'
  c.fillStyle = 'rgba(255,255,255,0.65)'
  c.fillText('PWR', x + w / 2, yTop + h + 3.6)

  c.restore()
}

// ---------- cue stick ----------

const CUE_LEN = 62 // table units

function drawCueStick(c: CanvasRenderingContext2D, o: DrawOpts) {
  const stick = o.cueStick
  if (!stick) return
  const cue = o.balls.find((b) => b.id === 0 && b.active)
  if (!cue) return

  const dirX = Math.cos(stick.angle)
  const dirY = Math.sin(stick.angle)

  // Gap between ball surface and stick tip; grows with pull-back power.
  // During the strike lunge it collapses to contact while the stick fades out.
  let gap: number
  let alpha = 1
  if (stick.strike !== undefined) {
    const k = Math.min(1, Math.max(0, stick.strike))
    const kp = Math.min(1, k / 0.78) // contact happens at t = 0.78
    const ease = kp * kp // accelerating strike into the ball
    gap = 1.4 + stick.power * 9 - ease * (1.25 + stick.power * 9)
    alpha = k < 0.78 ? 1 : Math.max(0, 1 - (k - 0.78) / 0.22)
  } else {
    gap = 1.4 + stick.power * 9
  }
  gap = Math.max(0.15, gap)

  const tipX = cue.x - dirX * (BALL_R + gap)
  const tipY = cue.y - dirY * (BALL_R + gap)

  c.save()
  c.globalAlpha = alpha
  c.lineCap = 'round'

  const seg = (t0: number, t1: number, w: number, style: string | CanvasGradient) => {
    c.strokeStyle = style
    c.lineWidth = w
    c.beginPath()
    c.moveTo(tipX - dirX * CUE_LEN * t0, tipY - dirY * CUE_LEN * t0)
    c.lineTo(tipX - dirX * CUE_LEN * t1, tipY - dirY * CUE_LEN * t1)
    c.stroke()
  }

  // soft ground shadow
  c.strokeStyle = 'rgba(0,0,0,0.28)'
  c.lineWidth = 2.2
  c.beginPath()
  c.moveTo(tipX + 0.8, tipY + 1.2)
  c.lineTo(tipX - dirX * CUE_LEN + 0.8, tipY - dirY * CUE_LEN + 1.2)
  c.stroke()

  // tapered body: maple shaft -> dark wrap -> butt cap
  const grad = c.createLinearGradient(tipX, tipY, tipX - dirX * CUE_LEN, tipY - dirY * CUE_LEN)
  grad.addColorStop(0, '#f0dcb4')
  grad.addColorStop(0.5, '#c99a5e')
  grad.addColorStop(0.58, '#7a4a26')
  grad.addColorStop(0.94, '#4c2b15')
  grad.addColorStop(1, '#2a1a10')
  seg(0.035, 0.58, 1.25, grad)
  seg(0.58, 0.96, 1.7, grad)
  seg(0.96, 1, 1.95, '#232a33')

  // ferrule + leather tip
  seg(0, 0.035, 1.1, '#f5f2e8')
  seg(-0.014, 0, 1.0, '#35719c')

  c.restore()
}

function drawSinking(c: CanvasRenderingContext2D, b: Ball, o: DrawOpts) {
  const p = Math.min(1, b.sinking ?? 0)
  const pocket = POCKETS[b.sinkPocket ?? 0]
  const x = b.x + (pocket.x - b.x) * p
  const y = b.y + (pocket.y - b.y) * p
  const scale = 1 - p * 0.85
  c.save()
  c.globalAlpha = 1 - p * 0.9
  const fake: Ball = { ...b, x, y }
  c.translate(x, y)
  c.scale(scale, scale)
  c.translate(-x, -y)
  drawBallBase(c, fake)
  c.restore()
  void o
}

function drawBall(c: CanvasRenderingContext2D, b: Ball, time: number) {
  // shadow
  c.fillStyle = 'rgba(0,0,0,0.32)'
  c.beginPath()
  c.ellipse(b.x + 0.9, b.y + 1.3, BALL_R * 0.95, BALL_R * 0.8, 0, 0, Math.PI * 2)
  c.fill()
  drawBallBase(c, b)
  void time
}

function drawBallBase(c: CanvasRenderingContext2D, b: Ball) {
  const color = BALL_COLORS[b.id] ?? '#ffffff'
  const isCue = b.id === 0
  const isStripe = b.id > 8

  // sphere base
  const grad = c.createRadialGradient(b.x - BALL_R * 0.45, b.y - BALL_R * 0.5, BALL_R * 0.15, b.x, b.y, BALL_R * 1.15)
  if (isCue) {
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.75, '#f2efe6')
    grad.addColorStop(1, '#c9c4b4')
  } else if (isStripe) {
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.6, '#f4f1e8')
    grad.addColorStop(1, '#b9b4a4')
  } else {
    grad.addColorStop(0, lighten(color, 0.55))
    grad.addColorStop(0.55, color)
    grad.addColorStop(1, darken(color, 0.35))
  }
  c.fillStyle = grad
  c.beginPath()
  c.arc(b.x, b.y, BALL_R, 0, Math.PI * 2)
  c.fill()

  // stripe band
  if (isStripe) {
    c.save()
    c.beginPath()
    c.arc(b.x, b.y, BALL_R, 0, Math.PI * 2)
    c.clip()
    c.fillStyle = color
    c.fillRect(b.x - BALL_R, b.y - BALL_R * 0.52, BALL_R * 2, BALL_R * 1.04)
    // re-shade the band
    const shade = c.createLinearGradient(b.x - BALL_R, 0, b.x + BALL_R, 0)
    shade.addColorStop(0, 'rgba(0,0,0,0.28)')
    shade.addColorStop(0.35, 'rgba(255,255,255,0.12)')
    shade.addColorStop(1, 'rgba(0,0,0,0.3)')
    c.fillStyle = shade
    c.fillRect(b.x - BALL_R, b.y - BALL_R * 0.52, BALL_R * 2, BALL_R * 1.04)
    c.restore()
  }

  // number patch
  if (!isCue) {
    c.fillStyle = '#f8f6ef'
    c.beginPath()
    c.arc(b.x, b.y, BALL_R * 0.46, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#1a1a1a'
    c.font = `bold ${BALL_R * 0.62}px system-ui, sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(String(b.id), b.x, b.y + BALL_R * 0.05)
  }

  // specular highlight
  c.fillStyle = 'rgba(255,255,255,0.75)'
  c.beginPath()
  c.ellipse(b.x - BALL_R * 0.38, b.y - BALL_R * 0.45, BALL_R * 0.22, BALL_R * 0.14, -0.6, 0, Math.PI * 2)
  c.fill()
}

// ---------- color helpers ----------

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function lighten(hex: string, amt: number) {
  const [r, g, b] = parseHex(hex)
  return `rgb(${clamp255(r + (255 - r) * amt)}, ${clamp255(g + (255 - g) * amt)}, ${clamp255(b + (255 - b) * amt)})`
}

function darken(hex: string, amt: number) {
  const [r, g, b] = parseHex(hex)
  return `rgb(${clamp255(r * (1 - amt))}, ${clamp255(g * (1 - amt))}, ${clamp255(b * (1 - amt))})`
}

export function isLegalPlacement(balls: Ball[], x: number, y: number, kitchenOnly: boolean) {
  return canPlaceCue(balls, x, y, kitchenOnly)
}

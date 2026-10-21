'use client'

// Interactive canvas table: renders the game, runs the rAF loop, handles
// slingshot aiming (drag anywhere + release), ball-in-hand placement and
// keyboard controls (arrows to aim, space to charge).
import { useCallback, useEffect, useRef } from 'react'
import { MAX_SHOT_SPEED, PLAY_H, PLAY_W, type Ball } from '@/lib/game/constants'
import type { PoolGame } from '@/lib/game/engine'
import { computeView, draw, isLegalPlacement, screenToTable, type View } from '@/lib/game/render'
import { playCueStrike, unlockAudio } from '@/lib/game/sound'

interface PoolTableProps {
  gameRef: React.MutableRefObject<PoolGame>
  interactive: boolean
  ballInHand: boolean
  kitchenOnly: boolean
  onShoot: (angle: number, power: number) => void
  onPlaceCue: (x: number, y: number) => void
}

interface DragState {
  startX: number
  startY: number
  x: number
  y: number
}

/** Pull-back distance (in TABLE units) that maps to 100% power. */
const MAX_DRAG = 55

export default function PoolTable({ gameRef, interactive, ballInHand, kitchenOnly, onShoot, onPlaceCue }: PoolTableProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef<DragState | null>(null)
  const placeRef = useRef<{ x: number; y: number } | null>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const kbRef = useRef<{ angle: number; power: number; dir: number; charging: boolean }>({ angle: 0, power: 0, dir: 1, charging: false })
  const kbActiveRef = useRef(false)
  const strikeRef = useRef<{ angle: number; power: number; t: number; fired: boolean } | null>(null)
  const interactiveRef = useRef(interactive)
  const ballInHandRef = useRef(ballInHand)
  const onShootRef = useRef(onShoot)
  const onPlaceCueRef = useRef(onPlaceCue)

  useEffect(() => {
    interactiveRef.current = interactive
    ballInHandRef.current = ballInHand
    onShootRef.current = onShoot
    onPlaceCueRef.current = onPlaceCue
  }, [interactive, ballInHand, onShoot, onPlaceCue])

  // ---------- pointer helpers ----------
  const ptrToTable = useCallback((clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current
    if (!canvas) return [0, 0]
    const rect = canvas.getBoundingClientRect()
    return screenToTable(viewRef.current, clientX - rect.left, clientY - rect.top)
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      unlockAudio()
      const g = gameRef.current
      if (!interactiveRef.current || !g || g.simulating) return
      ;(e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId)
      const [tx, ty] = ptrToTable(e.clientX, e.clientY)
      if (ballInHandRef.current) {
        placeRef.current = { x: tx, y: ty }
      } else {
        dragRef.current = { startX: tx, startY: ty, x: tx, y: ty }
        kbActiveRef.current = false
      }
    },
    [gameRef, ptrToTable]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const [tx, ty] = ptrToTable(e.clientX, e.clientY)
      if (ballInHandRef.current) {
        placeRef.current = { x: tx, y: ty }
        return
      }
      if (dragRef.current) {
        dragRef.current.x = tx
        dragRef.current.y = ty
      } else if (e.pointerType === 'mouse') {
        hoverRef.current = { x: tx, y: ty }
      }
    },
    [ptrToTable]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const g = gameRef.current
      if (!g) return
      const [tx, ty] = ptrToTable(e.clientX, e.clientY)
      if (ballInHandRef.current) {
        placeRef.current = { x: tx, y: ty }
        if (interactiveRef.current && isLegalPlacement(g.balls, tx, ty, kitchenOnly)) {
          onPlaceCueRef.current(tx, ty)
          placeRef.current = null
        }
        return
      }
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || !interactiveRef.current || g.simulating) return
      const dx = drag.startX - drag.x
      const dy = drag.startY - drag.y
      const dist = Math.hypot(dx, dy) // table units
      const power = Math.min(1, dist / MAX_DRAG)
      if (power > 0.06) {
        const angle = Math.atan2(dy, dx)
        // start the strike lunge; the shot is fired at contact inside the loop
        strikeRef.current = { angle, power, t: 0, fired: false }
      }
    },
    [gameRef, kitchenOnly, ptrToTable]
  )

  // ---------- keyboard ----------
  useEffect(() => {
    const g = gameRef.current
    const cue = g.balls.find((b) => b.id === 0)
    if (cue) kbRef.current.angle = Math.atan2(PLAY_H / 2 - cue.y, PLAY_W - cue.x)

    const onKeyDown = (e: KeyboardEvent) => {
      if (!interactiveRef.current) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        kbActiveRef.current = true
        kbRef.current.angle += (e.key === 'ArrowLeft' ? -1 : 1) * 0.012
      } else if (e.code === 'Space' && !ballInHandRef.current) {
        e.preventDefault()
        if (!kbRef.current.charging) {
          kbActiveRef.current = true
          kbRef.current.charging = true
          kbRef.current.power = 0
          kbRef.current.dir = 1
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && kbRef.current.charging) {
        e.preventDefault()
        kbRef.current.charging = false
        const g2 = gameRef.current
        if (!g2 || !interactiveRef.current || g2.simulating || ballInHandRef.current) return
        const power = Math.max(0.1, kbRef.current.power)
        const angle = kbRef.current.angle
        strikeRef.current = { angle, power, t: 0, fired: false }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [gameRef])

  // ---------- main loop ----------
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const resize = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w === 0 || h === 0) return
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const g = gameRef.current
      if (!g) return

      g.step(dt)

      // advance sink animations (visual only)
      for (const b of g.balls as Ball[]) {
        if (!b.active && b.sinking !== undefined && b.sinking < 1) {
          b.sinking = Math.min(1, b.sinking + dt * 3.2)
        }
      }

      // keyboard charging animation
      const kb = kbRef.current
      if (kb.charging) {
        kb.power += (kb.dir * dt) / 0.9
        if (kb.power >= 1) {
          kb.power = 1
          kb.dir = -1
        } else if (kb.power <= 0) {
          kb.power = 0
          kb.dir = 1
        }
      }

      // strike lunge: cue accelerates into the ball, shot fires at contact
      if (strikeRef.current) {
        const s = strikeRef.current
        s.t += dt / 0.14
        if (!s.fired && s.t >= 0.78) {
          s.fired = true
          playCueStrike(s.power * MAX_SHOT_SPEED)
          onShootRef.current(s.angle, s.power * MAX_SHOT_SPEED)
        }
        if (s.t >= 1) strikeRef.current = null
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = Math.min(2.5, window.devicePixelRatio || 1)
      const cssW = canvas.width / dpr
      const cssH = canvas.height / dpr
      viewRef.current = computeView(cssW, cssH)

      // determine aim overlay
      let aim: { angle: number; power: number } | null = null
      const canAim = interactiveRef.current && !g.simulating && !ballInHandRef.current
      if (canAim) {
        if (dragRef.current) {
          const d = dragRef.current
          const dx = d.startX - d.x
          const dy = d.startY - d.y
          const dist = Math.hypot(dx, dy)
          if (dist > 2) {
            aim = { angle: Math.atan2(dy, dx), power: Math.min(1, dist / MAX_DRAG) }
          }
        } else if (kbActiveRef.current) {
          aim = { angle: kb.angle, power: kb.charging ? kb.power : 0 }
        } else if (hoverRef.current) {
          const cue = g.balls.find((b) => b.id === 0 && b.active)
          if (cue) {
            const h = hoverRef.current
            if (Math.hypot(h.x - cue.x, h.y - cue.y) > 4) {
              aim = { angle: Math.atan2(h.y - cue.y, h.x - cue.x), power: 0 }
            }
          }
        }
        // keep the last known aim so the cue stick + guide stay visible on your turn
        if (!aim) aim = { angle: kb.angle, power: 0 }
        if (!kb.charging) kb.angle = aim.angle // mouse aiming stays in sync for space-to-shoot
      }

      // cue stick: strike lunge right after release, otherwise idle aim stick
      let cueStick: { angle: number; power: number; strike?: number } | null = null
      const st = strikeRef.current
      if (st) {
        cueStick = { angle: st.angle, power: st.power, strike: st.t }
        aim = null
      } else if (canAim && aim) {
        cueStick = { angle: aim.angle, power: aim.power }
      }

      // power gauge: shown on your turn, follows drag/charge/strike level
      let powerGauge: number | null = null
      if (canAim && !ballInHandRef.current) powerGauge = st ? st.power : aim ? aim.power : 0

      // ball-in-hand ghost
      let bih: { active: boolean; x: number; y: number; legal: boolean } | undefined
      if (ballInHandRef.current && interactiveRef.current && !g.simulating) {
        let gx: number | null = placeRef.current?.x ?? null
        let gy: number | null = placeRef.current?.y ?? null
        if (gx === null || gy === null) {
          const cue = g.balls.find((b) => b.id === 0)
          if (cue && cue.active) {
            gx = cue.x
            gy = cue.y
          } else {
            gx = kitchenOnly ? PLAY_W / 4 : PLAY_W / 2
            gy = PLAY_H / 2
          }
        }
        bih = {
          active: true,
          x: gx,
          y: gy,
          legal: isLegalPlacement(g.balls, gx, gy, kitchenOnly),
        }
      }

      draw(ctx, {
        balls: g.balls,
        view: viewRef.current,
        ctx,
        time: now / 1000,
        dpr,
        cssW,
        cssH,
        aim,
        ballInHand: bih,
        cueGlow: canAim,
        cueStick,
        powerGauge,
      })
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [gameRef, kitchenOnly])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Pool table. Press and drag away from your target to pull the cue back, release to shoot."
        role="img"
      />
    </div>
  )
}

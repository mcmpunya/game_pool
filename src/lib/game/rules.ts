import { BALL_R, PLAY_H, PLAY_W, POCKETS, ballType, type Ball, type Group, type RulesState, type ShotEvents } from './constants'
import { respotBall } from './physics'

export function initialRules(breaker: 0 | 1 = 0): RulesState {
  return {
    turn: breaker,
    groups: [null, null],
    phase: 'break',
    ballInHand: true, // breaker may place cue in kitchen
    kitchenOnly: true,
    winner: null,
    winReason: null,
    foul: false,
    foulReason: null,
    message: 'Break shot — place the cue ball in the kitchen and break!',
  }
}

export function groupCleared(balls: Ball[], group: Group | null): boolean {
  if (!group) return false
  return !balls.some((b) => b.active && ballType(b.id) === group)
}

function legalFirstContact(prev: RulesState, balls: Ball[], contact: number): boolean {
  const myGroup = prev.groups[prev.turn]
  if (prev.phase === 'break') return true // anything goes on the break
  if (myGroup === null) return contact !== 8 // open table: 8 first is a foul
  if (groupCleared(balls, myGroup)) return contact === 8 // must shoot the 8
  const t = ballType(contact)
  return t === myGroup
}

function firstPottedGroup(potted: number[]): Group | null {
  for (const id of potted) {
    const t = ballType(id)
    if (t === 'solid' || t === 'stripe') return t
  }
  return null
}

export interface ShotOutcome {
  next: RulesState
  respottedEight: boolean
  cueBallScratch: boolean
}

/** Apply the result of a shot to the rules state. `balls` = balls AFTER the shot. */
export function applyShot(prev: RulesState, balls: Ball[], ev: ShotEvents): ShotOutcome {
  const next: RulesState = { ...prev, foul: false, foulReason: null }
  const shooter = prev.turn
  const opponent = shooter === 0 ? 1 : 0
  const wasBreak = prev.phase === 'break'
  let respottedEight = false

  if (prev.phase === 'over') return { next, respottedEight, cueBallScratch: ev.cuePotted }

  if (wasBreak && !ev.cuePotted) {
    next.phase = 'open'
    next.kitchenOnly = false
  }

  const pottedObj = ev.potted
  const pottedEight = pottedObj.includes(8)
  const myGroup = prev.groups[shooter]
  const clearedBefore = groupCleared(balls, myGroup) // group balls on table AFTER shot

  // --- foul detection ---
  let foul = false
  let reason = ''
  if (ev.cuePotted) {
    foul = true
    reason = 'Scratch — cue ball potted'
  } else if (ev.firstContact === null) {
    foul = true
    reason = 'Foul — no ball contacted'
  } else if (!legalFirstContact(prev, balls, ev.firstContact)) {
    foul = true
    reason = myGroup
      ? 'Foul — wrong ball hit first'
      : 'Foul — hit the 8-ball first'
  }

  // --- 8-ball handling ---
  if (pottedEight && !wasBreak) {
    const hadGroupBallsAtStart = myGroup !== null && balls.some((b) => b.active && ballType(b.id) === myGroup)
    const stillHadOwn = myGroup !== null && !clearedBefore && hadGroupBallsAtStart
    // if group not yet assigned, any early 8 is a loss
    const illegalEight = myGroup === null || stillHadOwn || foul
    if (illegalEight) {
      next.phase = 'over'
      next.winner = opponent
      next.winReason = foul
        ? 'Opponent potted the 8-ball on a foul'
        : 'Opponent potted the 8-ball too early'
      next.message = 'Game over'
      return { next, respottedEight, cueBallScratch: ev.cuePotted }
    }
    // legal 8 pot → win
    next.phase = 'over'
    next.winner = shooter
    next.winReason = 'Potted the 8-ball'
    next.message = 'Game over'
    return { next, respottedEight, cueBallScratch: ev.cuePotted }
  }

  if (pottedEight && wasBreak) {
    respotBall(balls, 8)
    respottedEight = true
  }

  // --- group assignment (only after the break, on a legal pot, table open) ---
  let assignedThisShot = false
  if (next.phase === 'open' && !foul) {
    const g = firstPottedGroup(pottedObj)
    if (g) {
      next.groups = shooter === 0 ? [g, g === 'solid' ? 'stripe' : 'solid'] : [g === 'solid' ? 'stripe' : 'solid', g]
      next.phase = 'assigned'
      assignedThisShot = true
    }
  }

  // --- scratch: restore cue ball (opponent places it) ---
  if (ev.cuePotted) {
    const cue = balls.find((b) => b.id === 0)
    if (cue) {
      cue.active = true
      cue.sinking = undefined
      cue.sinkPocket = undefined
      cue.vx = 0
      cue.vy = 0
      cue.x = 50
      cue.y = 50
    }
  }

  // --- continue turn or pass ---
  let keepTurn = false
  if (!foul) {
    if (wasBreak) {
      keepTurn = pottedObj.length > 0 // potted on the break (8 re-spotted doesn't count)
    } else {
      const shooterGroup = next.groups[shooter]
      if (shooterGroup) {
        keepTurn = pottedObj.some((id) => ballType(id) === shooterGroup)
      } else {
        keepTurn = assignedThisShot // always true here when a pot assigned groups
      }
    }
  }

  if (foul) {
    next.foul = true
    next.foulReason = reason
    next.ballInHand = true
    next.turn = opponent
    next.message = `${reason} — ball in hand for ${opponent === 0 ? 'Player 1' : 'Player 2'}`
  } else if (keepTurn) {
    next.turn = shooter
    const myG = next.groups[shooter]
    const pottedMine = pottedObj.filter((id) => (myG ? ballType(id) === myG : ballType(id) !== 'eight'))
    next.message = pottedMine.length > 0 ? 'Nice pot — shoot again!' : 'Shoot again'
    next.ballInHand = false
  } else {
    next.turn = opponent
    next.ballInHand = false
    next.message = ''
  }

  return { next, respottedEight, cueBallScratch: ev.cuePotted }
}

/** Can the cue ball be placed at (x, y)? */
export function canPlaceCue(balls: Ball[], x: number, y: number, kitchenOnly: boolean): boolean {
  const m = BALL_R + 0.3
  if (x < m || x > PLAY_W - m || y < m || y > PLAY_H - m) return false
  if (kitchenOnly && x > PLAY_W / 4) return false
  // not on or beside a pocket mouth (the ball would drop straight in)
  for (const pk of POCKETS) {
    if (Math.hypot(pk.x - x, pk.y - y) < pk.r + BALL_R * 0.6) return false
  }
  for (const b of balls) {
    if (!b.active || b.id === 0) continue
    if (Math.hypot(b.x - x, b.y - y) < BALL_R * 2 + 0.2) return false
  }
  return true
}

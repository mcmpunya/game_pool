import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { eloDeltas, ensureHouseBots, sanitizeName } from '@/lib/leaderboard'

export const dynamic = 'force-dynamic'

/** GET /api/matches?limit=15 — recent finished matches. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 15) || 15))
  const matches = await db.match.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  return NextResponse.json({ matches })
}

interface RecordBody {
  matchId?: string
  mode?: string
  winnerName?: string
  loserName?: string
  winnerBalls?: number
  loserBalls?: number
  durationSec?: number
}

/** POST /api/matches — record a finished match and update ELO ratings. Idempotent by matchId. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RecordBody | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const matchId = typeof body.matchId === 'string' ? body.matchId.slice(0, 64) : null
  const winnerName = sanitizeName(body.winnerName)
  const loserName = sanitizeName(body.loserName)
  const mode = ['bot', 'online'].includes(body.mode ?? '') ? body.mode : null

  if (!matchId || !winnerName || !loserName || !mode) {
    return NextResponse.json({ error: 'matchId, winnerName, loserName, mode are required' }, { status: 400 })
  }
  if (winnerName === loserName) {
    return NextResponse.json({ error: 'Winner and loser must differ' }, { status: 400 })
  }

  await ensureHouseBots()

  // Idempotency: if this match was already recorded, return the stored result.
  const existing = await db.match.findUnique({ where: { id: matchId } })
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, match: existing })
  }

  // Make sure both players exist.
  const winner = await db.player.upsert({ where: { name: winnerName }, update: {}, create: { name: winnerName } })
  const loser = await db.player.upsert({ where: { name: loserName }, update: {}, create: { name: loserName } })

  const { winnerDelta, loserDelta } = eloDeltas(winner.rating, loser.rating)
  const winnerBalls = Math.max(0, Math.min(7, Number(body.winnerBalls ?? 0) || 0))
  const loserBalls = Math.max(0, Math.min(7, Number(body.loserBalls ?? 0) || 0))
  const durationSec = Math.max(0, Math.min(7200, Number(body.durationSec ?? 0) || 0))

  const [match, newWinner, newLoser] = await db.$transaction([
    db.match.create({
      data: {
        id: matchId,
        mode,
        winnerName,
        loserName,
        winnerDelta,
        loserDelta,
        winnerBalls,
        loserBalls,
        durationSec,
      },
    }),
    db.player.update({
      where: { name: winnerName },
      data: {
        rating: { increment: winnerDelta },
        wins: { increment: 1 },
        gamesPlayed: { increment: 1 },
        ballsPotted: { increment: winnerBalls },
        currentStreak: { increment: 1 },
        bestStreak: { increment: 0 },
      },
    }),
    db.player.update({
      where: { name: loserName },
      data: {
        rating: Math.max(100, loser.rating + loserDelta),
        losses: { increment: 1 },
        gamesPlayed: { increment: 1 },
        ballsPotted: { increment: loserBalls },
        currentStreak: 0,
      },
    }),
  ])

  // Track best streak properly (increment above cannot compare).
  if (newWinner.currentStreak > winner.bestStreak) {
    await db.player.update({ where: { name: winnerName }, data: { bestStreak: newWinner.currentStreak } })
  }

  return NextResponse.json({
    ok: true,
    match,
    winner: { name: winnerName, rating: newWinner.rating, delta: winnerDelta },
    loser: { name: loserName, rating: newLoser.rating, delta: loserDelta },
  })
}

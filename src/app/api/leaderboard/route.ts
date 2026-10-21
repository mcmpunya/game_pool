import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureHouseBots } from '@/lib/leaderboard'

export const dynamic = 'force-dynamic'

/** GET /api/leaderboard — top players by rating. */
export async function GET() {
  await ensureHouseBots()
  const players = await db.player.findMany({
    orderBy: [{ rating: 'desc' }, { wins: 'desc' }, { createdAt: 'asc' }],
    take: 100,
    select: {
      name: true,
      rating: true,
      wins: true,
      losses: true,
      gamesPlayed: true,
      ballsPotted: true,
      bestStreak: true,
      currentStreak: true,
      isBot: true,
    },
  })
  return NextResponse.json({
    players: players.map((p, i) => ({ rank: i + 1, ...p })),
  })
}

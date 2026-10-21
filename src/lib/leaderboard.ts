import { db } from '@/lib/db'

// Seed a roster of house bots so the leaderboard is never empty.
const HOUSE_BOTS: { name: string; rating: number }[] = [
  { name: 'Grandmaster Bot', rating: 1420 },
  { name: 'Sharpshooter Bot', rating: 1240 },
  { name: 'Side Pocket Sally', rating: 1180 },
  { name: 'Bank Shot Ben', rating: 1100 },
  { name: 'The Shark', rating: 1030 },
  { name: 'Chalk Dust', rating: 960 },
  { name: 'Lucky Lou', rating: 900 },
  { name: 'Rookie Bot', rating: 820 },
]

export async function ensureHouseBots() {
  const count = await db.player.count()
  if (count > 0) return
  await db.player.createMany({
    data: HOUSE_BOTS.map((b) => ({
      name: b.name,
      rating: b.rating,
      isBot: true,
      gamesPlayed: 0,
    })),
  })
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)
  if (name.length < 1 || name.length > 24) return null
  return name
}

export function eloDeltas(winnerRating: number, loserRating: number, K = 32) {
  const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400))
  const winnerDelta = Math.max(4, Math.round(K * (1 - expected)))
  const loserDelta = -Math.min(winnerDelta, Math.max(2, Math.round(K * expected * 0.9)))
  return { winnerDelta, loserDelta }
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureHouseBots, sanitizeName } from '@/lib/leaderboard'

export const dynamic = 'force-dynamic'

/** GET /api/players?name=X — look up a player's stats. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const name = sanitizeName(url.searchParams.get('name'))
  if (!name) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  const player = await db.player.findUnique({ where: { name } })
  return NextResponse.json({ player: player ?? null })
}

/** POST /api/players { name } — register a player (idempotent). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const name = sanitizeName((body as { name?: unknown } | null)?.name)
  if (!name) return NextResponse.json({ error: 'Name must be 1-24 characters' }, { status: 400 })

  await ensureHouseBots()
  const player = await db.player.upsert({
    where: { name },
    update: {},
    create: { name },
  })
  return NextResponse.json({ player })
}

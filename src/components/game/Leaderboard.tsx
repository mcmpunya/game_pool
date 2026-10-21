'use client'

// Leaderboard: ELO rankings + recent matches.
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Bot, RefreshCw, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface LeaderboardProps {
  playerName: string
  onBack: () => void
  refreshKey: number
}

interface Row {
  rank: number
  name: string
  rating: number
  wins: number
  losses: number
  gamesPlayed: number
  ballsPotted: number
  bestStreak: number
  currentStreak: number
  isBot: boolean
}

interface MatchRow {
  id: string
  mode: string
  winnerName: string
  loserName: string
  winnerDelta: number
  loserDelta: number
  createdAt: string
}

export default function Leaderboard({ playerName, onBack, refreshKey }: LeaderboardProps) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [matches, setMatches] = useState<MatchRow[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [lb, ms] = await Promise.all([
        fetch('/api/leaderboard').then((r) => r.json()),
        fetch('/api/matches?limit=12').then((r) => r.json()),
      ])
      setRows((lb as { players: Row[] }).players ?? [])
      setMatches((ms as { matches: MatchRow[] }).matches ?? [])
    } catch {
      setRows([])
      setMatches([])
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const medal = (rank: number) => (rank === 1 ? 'text-amber-300' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-white/40')

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[radial-gradient(ellipse_at_top,#134e35_0%,#0c1f17_60%)] text-white">
      <div className="mx-auto w-full max-w-md flex-1 px-5 py-6">
        <div className="mb-5 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-white/70 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Menu
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} className="text-white/70">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <h1 className="mb-1 flex items-center gap-2 text-2xl font-black">
          <Trophy className="h-6 w-6 text-amber-300" /> Leaderboard
        </h1>
        <p className="mb-5 text-sm text-white/55">ELO ratings — every bot and online match counts.</p>

        <Card className="mb-6 border-white/10 bg-white/5">
          <CardContent className="p-0">
            <div className="max-h-[52vh] overflow-y-auto [scrollbar-color:rgba(255,255,255,0.25)_transparent] [scrollbar-width:thin]">
              <div className="min-w-0">
                {rows === null ? (
                  <div className="space-y-2 p-4">
                    {Array.from({ length: 6 }, (_, i) => (
                      <Skeleton key={i} className="h-10 w-full bg-white/10" />
                    ))}
                  </div>
                ) : rows.length === 0 ? (
                  <p className="p-6 text-center text-sm text-white/50">No players yet — play a match!</p>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {rows.map((r) => {
                      const isMe = r.name === playerName && !r.isBot
                      return (
                        <li key={r.name} className={`flex items-center gap-3 px-4 py-2.5 ${isMe ? 'bg-emerald-400/10' : ''}`}>
                          <span className={`w-7 text-center text-sm font-bold ${medal(r.rank)}`}>
                            {r.rank <= 3 ? ['1st', '2nd', '3rd'][r.rank - 1] : r.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {r.isBot && <Bot className="h-3.5 w-3.5 shrink-0 text-white/40" />}
                              <span className={`truncate text-sm font-medium ${isMe ? 'text-emerald-300' : ''}`}>{r.name}</span>
                              {r.currentStreak >= 2 && (
                                <Badge variant="outline" className="border-amber-300/40 px-1 text-[9px] text-amber-200">
                                  {r.currentStreak} streak
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-white/45">
                              {r.wins}W · {r.losses}L · {r.gamesPlayed} games · {r.ballsPotted} balls
                            </span>
                          </div>
                          <span className="text-base font-bold tabular-nums">{r.rating}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-white/60">Recent matches</h2>
        <Card className="border-white/10 bg-white/5">
          <CardContent className="p-0">
            {matches === null ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-8 w-full bg-white/10" />
                ))}
              </div>
            ) : matches.length === 0 ? (
              <p className="p-5 text-center text-sm text-white/50">No matches recorded yet.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {matches.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                      <b className="text-emerald-300">{m.winnerName}</b>
                      <span className="text-white/40"> def. </span>
                      {m.loserName}
                    </span>
                    <span className="shrink-0 tabular-nums text-white/50">
                      +{m.winnerDelta}/−{Math.abs(m.loserDelta)}
                    </span>
                    <Badge variant="outline" className="shrink-0 border-white/15 text-[9px] uppercase text-white/50">{m.mode}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

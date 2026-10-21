'use client'

// Main menu: profile name, game modes, install button.
import { useEffect, useState } from 'react'
import { Bot, Gamepad2, Globe, Trophy, User, Volume2, VolumeX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { isMuted, setMuted } from '@/lib/game/sound'
import PwaInstallButton from './PwaInstallButton'

interface MenuProps {
  playerName: string
  onNameChange: (name: string) => void
  onPlayBot: (difficulty: 'easy' | 'medium' | 'hard') => void
  onLocal: () => void
  onOnline: () => void
  onLeaderboard: () => void
}

interface MyStats {
  rating: number
  wins: number
  losses: number
  gamesPlayed: number
  bestStreak: number
}

export default function Menu({ playerName, onNameChange, onPlayBot, onLocal, onOnline, onLeaderboard }: MenuProps) {
  const [showDiff, setShowDiff] = useState(false)
  const [stats, setStats] = useState<MyStats | null>(null)
  const [mutedState, setMutedState] = useState(isMuted)

  useEffect(() => {
    if (!playerName.trim()) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/players?name=${encodeURIComponent(playerName.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d: { player: MyStats | null }) => setStats(d.player))
        .catch(() => {})
    }, 400)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [playerName])

  const toggleMute = () => {
    const next = !isMuted()
    setMuted(next)
    setMutedState(next)
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[radial-gradient(ellipse_at_top,#134e35_0%,#0c1f17_60%)] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-8">
        {/* header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-neutral-900 to-black shadow-[inset_-6px_-8px_14px_rgba(255,255,255,0.08),0_10px_30px_rgba(0,0,0,0.5)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f3ea] text-2xl font-black text-neutral-900">8</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            8-Ball <span className="text-amber-300">Champions</span>
          </h1>
          <p className="mt-1.5 text-sm text-white/55">Online &amp; bot pool — playable anywhere, installable as an app</p>
        </div>

        {/* name */}
        <Card className="mb-5 border-white/10 bg-white/5 backdrop-blur">
          <CardContent className="p-4">
            <label htmlFor="player-name" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">
              <User className="h-3.5 w-3.5" /> Your name (for the leaderboard)
            </label>
            <Input
              id="player-name"
              value={playerName}
              onChange={(e) => onNameChange(e.target.value.slice(0, 24))}
              placeholder="e.g. PoolShark99"
              className="border-white/15 bg-black/25 text-white placeholder:text-white/30 focus-visible:ring-amber-300/60"
              maxLength={24}
            />
            {stats && playerName.trim() && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
                <Badge variant="outline" className="border-amber-300/40 text-amber-200">{stats.rating} pts</Badge>
                <Badge variant="outline" className="border-emerald-400/40 text-emerald-200">{stats.wins}W / {stats.losses}L</Badge>
                {stats.bestStreak > 0 && (
                  <Badge variant="outline" className="border-white/20 text-white/70">Best streak {stats.bestStreak}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* modes */}
        <div className="space-y-3">
          {!showDiff ? (
            <ModeButton
              icon={<Bot className="h-5 w-5" />}
              title="Play vs Bot"
              subtitle="Single player — 3 difficulty levels"
              onClick={() => setShowDiff(true)}
            />
          ) : (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-white/60">Choose difficulty</p>
              <ModeButton icon={<span className="text-lg font-black opacity-70">1</span>} title="Rookie" subtitle="Misses now and then — great to learn" onClick={() => onPlayBot('easy')} small />
              <ModeButton icon={<span className="text-lg font-black opacity-70">2</span>} title="Sharpshooter" subtitle="Solid potter, punishes mistakes" onClick={() => onPlayBot('medium')} small />
              <ModeButton icon={<span className="text-lg font-black opacity-70">3</span>} title="Grandmaster" subtitle="Clinical — plans multi-ball runs" onClick={() => onPlayBot('hard')} small />
              <button onClick={() => setShowDiff(false)} className="w-full py-1 text-center text-xs text-white/40 hover:text-white/70">
                Cancel
              </button>
            </div>
          )}
          <ModeButton
            icon={<Gamepad2 className="h-5 w-5" />}
            title="Local 2 Players"
            subtitle="Pass & play on one device"
            onClick={onLocal}
          />
          <ModeButton
            icon={<Globe className="h-5 w-5" />}
            title="Online Multiplayer"
            subtitle="Create or join a room, or quick match"
            onClick={onOnline}
          />
          <ModeButton
            icon={<Trophy className="h-5 w-5" />}
            title="Leaderboard"
            subtitle="Rankings & recent matches"
            onClick={onLeaderboard}
          />
        </div>

        <div className="mt-auto flex items-center justify-between pt-8">
          <PwaInstallButton />
          <Button variant="ghost" size="sm" onClick={toggleMute} className="text-white/50 hover:text-white">
            {mutedState ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            <span className="ml-1 text-xs">{mutedState ? 'Muted' : 'Sound'}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

function ModeButton({
  icon,
  title,
  subtitle,
  onClick,
  small,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 text-left transition-all hover:border-amber-300/50 hover:bg-white/10 active:scale-[0.99] ${small ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}
    >
      <span className={`flex items-center justify-center rounded-lg bg-amber-300/15 text-amber-300 ${small ? 'h-8 w-8' : 'h-10 w-10'}`}>{icon}</span>
      <span className="min-w-0">
        <span className={`block font-semibold ${small ? 'text-sm' : 'text-base'}`}>{title}</span>
        <span className="block truncate text-xs text-white/50">{subtitle}</span>
      </span>
    </button>
  )
}

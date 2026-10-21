'use client'

// Game orchestrator: owns the PoolGame engine, HUD, sounds, bot turns,
// online sync and match recording (ELO).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX, Trophy } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Group, PlayerInfo, ballType } from '@/lib/game/constants'
import { PoolGame, type ShotSettledInfo } from '@/lib/game/engine'
import { BOT_THINK_MS, botDecide } from '@/lib/game/bot'
import { GameSyncPayload, getSocket } from '@/lib/game/net'
import { isMuted, setMuted, unlockAudio } from '@/lib/game/sound'
import PoolTable from './PoolTable'

export interface GameConfig {
  mode: 'bot' | 'local' | 'online'
  botDifficulty?: 'easy' | 'medium' | 'hard'
  online?: { seat: 0 | 1; roomCode: string; opponentName: string }
}

interface GameScreenProps {
  playerName: string
  playerTwoName: string
  config: GameConfig
  onExit: () => void
  onViewLeaderboard: () => void
  onMatchRecorded: () => void
}

interface GameOverState {
  winner: 0 | 1
  reason: string
  record: {
    myDelta: number | null
    newRating: number | null
    opponentDelta: number | null
  } | null
}

interface RecordResult {
  winner: { name: string; rating: number; delta: number }
  loser: { name: string; rating: number; delta: number }
}

const BOT_NAMES: Record<string, string> = {
  easy: 'Rookie Bot',
  medium: 'Sharpshooter Bot',
  hard: 'Grandmaster Bot',
}

export default function GameScreen({ playerName, playerTwoName, config, onExit, onViewLeaderboard, onMatchRecorded }: GameScreenProps) {
  const { toast } = useToast()
  const gameRef = useRef<PoolGame | null>(null)
  if (!gameRef.current) {
    const players = makePlayers(config, playerName, playerTwoName)
    gameRef.current = new PoolGame(players, 0)
  }
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [mutedState, setMutedState] = useState(false)
  const [gameOver, setGameOver] = useState<GameOverState | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [synced, setSynced] = useState(config.mode !== 'online' || config.online!.seat === 0)
  const [opponentLeft, setOpponentLeft] = useState<string | null>(null)
  const [rematchOffer, setRematchOffer] = useState<string | null>(null)
  const [waitingRematch, setWaitingRematch] = useState(false)
  const [chatBubble, setChatBubble] = useState<string | null>(null)

  const pottedByRef = useRef<[number, number]>([0, 0])
  const startRef = useRef(Date.now())
  const recordedRef = useRef(false)
  const pendingSyncRef = useRef<GameSyncPayload | null>(null)
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const breakerRef = useRef<0 | 1>(0)
  const gameRefStable = gameRef as React.MutableRefObject<PoolGame>

  const seat = config.mode === 'online' ? config.online!.seat : 0
  const isHost = config.mode !== 'online' || seat === 0

  // ---------- sounds ----------
  useEffect(() => {
    const g = gameRef.current
    if (!g) return
    g.simCallbacks = {
      onBallHit: (speed) => void import('@/lib/game/sound').then((m) => m.playBallHit(speed)),
      onCushion: (speed) => void import('@/lib/game/sound').then((m) => m.playCushion(speed)),
      onPot: () => void import('@/lib/game/sound').then((m) => m.playPocket()),
    }
  }, [])

  // ---------- match recording ----------
  const recordMatch = useCallback(
    async (winner: 0 | 1, reason: string) => {
      if (config.mode === 'local' || recordedRef.current) return
      recordedRef.current = true
      const g = gameRef.current!
      const winnerName = g.players[winner].name
      const loserName = g.players[1 - winner].name
      const winnerBalls = Math.min(8, pottedByRef.current[winner] + (reason.includes('8-ball') ? 1 : 0))
      const loserBalls = Math.min(8, pottedByRef.current[1 - winner])
      const durationSec = Math.round((Date.now() - startRef.current) / 1000)
      const matchId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
      try {
        const res = await fetch('/api/matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchId,
            mode: config.mode === 'bot' ? 'bot' : 'online',
            winnerName,
            loserName,
            winnerBalls,
            loserBalls,
            durationSec,
          }),
        })
        const data = (await res.json()) as { ok?: boolean; winner?: RecordResult['winner']; loser?: RecordResult['loser'] }
        const myName = config.mode === 'bot' ? playerName : undefined
        let myDelta: number | null = null
        let newRating: number | null = null
        if (config.mode === 'bot' && data.winner && data.loser) {
          const mine = data.winner.name === myName ? data.winner : data.loser
          myDelta = mine.delta
          newRating = mine.rating
        }
        setGameOver({
          winner,
          reason,
          record: { myDelta, newRating, opponentDelta: null },
        })
        if (data.ok) onMatchRecorded()
      } catch {
        setGameOver({ winner, reason, record: null })
      }
    },
    [config.mode, config.online, onMatchRecorded, playerName]
  )

  // ---------- bot scheduling ----------
  const scheduleBot = useCallback(() => {
    if (config.mode !== 'bot') return
    const difficulty = config.botDifficulty ?? 'medium'
    if (botTimerRef.current) clearTimeout(botTimerRef.current)
    const g = gameRef.current
    if (!g || g.simulating || g.rules.phase === 'over') return
    if (g.rules.turn !== 1) return
    botTimerRef.current = setTimeout(() => {
      const g2 = gameRef.current
      if (!g2 || g2.simulating || g2.rules.phase === 'over' || g2.rules.turn !== 1) return
      unlockAudio()
      const decision = botDecide(g2.rules, g2.balls, difficulty)
      if (decision.placeCue) g2.placeCue(decision.placeCue.x, decision.placeCue.y)
      g2.shoot(decision.angle, decision.power)
      bump()
    }, BOT_THINK_MS(difficulty))
  }, [bump, config.botDifficulty, config.mode])

  // ---------- shot settled ----------
  const handleSettled = useCallback(
    (info: ShotSettledInfo) => {
      const g = gameRef.current
      if (!g) return
      for (const id of info.events.potted) {
        if (id !== 8 && id !== 0) pottedByRef.current[info.shooter]++
      }

      // online sync
      if (config.mode === 'online') {
        const s = getSocket()
        if (isHost) {
          s.emit('shot-result', {
            balls: g.balls.map((b) => ({ ...b })),
            rules: { ...g.rules },
            lastShot: {
              shooter: info.shooter,
              potted: info.events.potted,
              foul: info.rules.foul,
              foulReason: info.rules.foulReason,
            },
          })
        } else if (pendingSyncRef.current) {
          const p = pendingSyncRef.current
          pendingSyncRef.current = null
          g.applySync(p.balls, p.rules)
        }
      }

      if (info.rules.phase === 'over' && info.rules.winner !== null) {
        void recordMatch(info.rules.winner, info.rules.winReason ?? 'Won the game')
        if (!recordedRef.current) setGameOver({ winner: info.rules.winner, reason: info.rules.winReason ?? 'Won the game', record: null })
        // recordMatch sets gameOver again with deltas; ensure immediate UI too
      } else {
        scheduleBot()
      }
      bump()
    },
    [bump, config.mode, isHost, recordMatch, scheduleBot]
  )

  useEffect(() => {
    const g = gameRef.current
    if (g) g.onShotSettled = handleSettled
  }, [handleSettled])

  // ---------- ratings lookup (keyed by name — seat order can swap after sync) ----------
  const fetchRatings = useCallback((names: string[]) => {
    void Promise.all(
      names.map(async (n) => {
        try {
          const res = await fetch(`/api/players?name=${encodeURIComponent(n)}`)
          const data = (await res.json()) as { player: { rating: number } | null }
          if (data.player) {
            setRatings((prev) => ({ ...prev, [n]: data.player!.rating }))
          }
        } catch {
          /* ignore */
        }
      })
    )
  }, [])

  useEffect(() => {
    if (config.mode === 'local') return
    const g = gameRef.current
    if (!g) return
    fetchRatings([g.players[0].name, g.players[1].name])
  }, [config.mode, fetchRatings])

  // ---------- online wiring ----------
  useEffect(() => {
    if (config.mode !== 'online') return
    const s = getSocket()
    const g = gameRef.current

    const sendHostState = () => {
      const g2 = gameRef.current
      if (g2 && seat === 0) {
        s.emit('host-state', {
          balls: g2.balls.map((b) => ({ ...b })),
          rules: { ...g2.rules },
          players: g2.players.map((p) => ({ name: p.name, isBot: false })),
        })
      }
    }
    // host announces the initial state on mount (harmless if the guest is not
    // ready yet) and again when the guest signals it is up
    sendHostState()

    const onOpponentShot = (data: { angle: number; power: number }) => {
      const g2 = gameRef.current
      if (!g2 || g2.simulating || g2.rules.phase === 'over') return
      unlockAudio()
      g2.shoot(data.angle, data.power)
      bump()
    }
    const onGameSync = (data: GameSyncPayload) => {
      const g2 = gameRef.current
      if (!g2) return
      if (g2.simulating) {
        pendingSyncRef.current = data
      } else {
        g2.applySync(data.balls, data.rules)
      }
      bump()
    }
    const onCuePlaced = (data: { x: number; y: number }) => {
      const g2 = gameRef.current
      if (!g2) return
      g2.placeCue(data.x, data.y)
      bump()
    }
    const onOpponentLeft = (data: { message: string }) => {
      setOpponentLeft(data.message || 'Opponent left the match')
    }
    const onRematchOffered = (data: { from: string }) => {
      setRematchOffer(data.from)
      setWaitingRematch(false)
    }
    const onRematchStarted = () => {
      if (seat === 0) {
        const g2 = gameRef.current
        if (g2) {
          const nextBreaker: 0 | 1 = breakerRef.current === 0 ? 1 : 0
          breakerRef.current = nextBreaker
          g2.rack(nextBreaker)
          s.emit('host-state', {
            balls: g2.balls.map((b) => ({ ...b })),
            rules: { ...g2.rules },
            players: g2.players.map((p) => ({ name: p.name, isBot: false })),
          })
        }
      }
      setGameOver(null)
      setWaitingRematch(false)
      setRematchOffer(null)
      recordedRef.current = false
      pottedByRef.current = [0, 0]
      startRef.current = Date.now()
      bump()
    }
    const onGameStart = (data: GameSyncPayload & { players?: { name: string; isBot: boolean }[] }) => {
      const g2 = gameRef.current
      if (!g2) return
      if (data.players) {
        g2.players = [data.players[0], data.players[1]] as [PlayerInfo, PlayerInfo]
        fetchRatings([g2.players[0].name, g2.players[1].name])
      }
      g2.applySync(data.balls, data.rules)
      setSynced(true)
      setGameOver(null)
      recordedRef.current = false
      pottedByRef.current = [0, 0]
      startRef.current = Date.now()
      bump()
    }
    const onChat = (data: { from: string; text: string }) => {
      setChatBubble(`${data.from}: ${data.text}`)
      setTimeout(() => setChatBubble(null), 3500)
    }

    const onGuestReady = () => sendHostState()

    s.on('opponent-shot', onOpponentShot)
    s.on('game-sync', onGameSync)
    s.on('cue-placed', onCuePlaced)
    s.on('opponent-left', onOpponentLeft)
    s.on('rematch-offered', onRematchOffered)
    s.on('rematch-started', onRematchStarted)
    s.on('game-start', onGameStart)
    s.on('chat', onChat)
    s.on('guest-ready', onGuestReady)
    if (seat === 1) s.emit('guest-ready')
    return () => {
      s.off('opponent-shot', onOpponentShot)
      s.off('game-sync', onGameSync)
      s.off('cue-placed', onCuePlaced)
      s.off('opponent-left', onOpponentLeft)
      s.off('rematch-offered', onRematchOffered)
      s.off('rematch-started', onRematchStarted)
      s.off('game-start', onGameStart)
      s.off('chat', onChat)
      s.off('guest-ready', onGuestReady)
    }
  }, [bump, config.mode, fetchRatings, seat])

  // schedule the bot on mount as well (e.g. after rematch where bot breaks)
  useEffect(() => {
    scheduleBot()
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current)
    }
  }, [scheduleBot])

  // ---------- actions ----------
  const myTurnInteractive = (() => {
    const g = gameRef.current
    if (!g || g.simulating || g.rules.phase === 'over' || opponentLeft || !synced) return false
    if (config.mode === 'local') return true
    return g.rules.turn === seat
  })()

  const handleShoot = useCallback(
    (angle: number, power: number) => {
      const g = gameRef.current
      if (!g) return
      if (g.shoot(angle, power)) {
        if (config.mode === 'online') getSocket().emit('shot', { angle, power })
        bump()
      }
    },
    [bump, config.mode]
  )

  const handlePlaceCue = useCallback(
    (x: number, y: number) => {
      const g = gameRef.current
      if (!g) return
      if (g.placeCue(x, y)) {
        if (config.mode === 'online') getSocket().emit('place-cue', { x, y })
        bump()
      }
    },
    [bump, config.mode]
  )

  const handleRematch = useCallback(() => {
    const g = gameRef.current
    if (!g) return
    if (config.mode === 'online') {
      getSocket().emit('rematch-offer')
      setWaitingRematch(true)
      return
    }
    // local / bot: winner breaks
    const breaker = (gameOver?.winner ?? 0) as 0 | 1
    breakerRef.current = breaker
    g.rack(breaker)
    pottedByRef.current = [0, 0]
    startRef.current = Date.now()
    recordedRef.current = false
    setGameOver(null)
    if (config.mode !== 'bot') setRatings({})
    scheduleBot()
    bump()
  }, [bump, config.mode, gameOver, scheduleBot])

  const acceptRematch = useCallback(() => {
    getSocket().emit('rematch-accept')
    setRematchOffer(null)
    setWaitingRematch(true)
  }, [])

  const handleExit = useCallback(() => {
    if (config.mode === 'online') {
      getSocket().emit('leave-room')
    }
    onExit()
  }, [config.mode, onExit])

  const toggleMute = useCallback(() => {
    const next = !isMuted()
    setMuted(next)
    setMutedState(next)
  }, [])

  // ---------- HUD data ----------
  const g = gameRef.current!
  const rules = g.rules
  const players = g.players
  const myIndex = seat
  const over = rules.phase === 'over'

  const remaining = (grp: Group | null): number => {
    if (!grp) return 0
    return g.balls.filter((b) => b.active && ballType(b.id) === grp).length
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-[#0c1f17] text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* score bar */}
      <div className="flex items-stretch gap-2 px-2 pt-2 sm:px-4">
        <PlayerCard
          name={players[0].name}
          rating={ratings[players[0].name] ?? null}
          group={rules.groups[0]}
          remaining={remaining(rules.groups[0])}
          active={rules.turn === 0 && !over}
          isMe={config.mode !== 'local' ? seat === 0 : false}
          onBreak={rules.phase === 'break' && rules.turn === 0}
        />
        <div className="flex flex-col items-center justify-center px-1">
          <span className="text-[10px] uppercase tracking-wider text-white/50">8-Ball</span>
          {config.mode === 'online' && (
            <Badge variant="outline" className="mt-0.5 border-white/20 font-mono text-[10px] text-white/70">
              {config.online!.roomCode}
            </Badge>
          )}
          {config.mode === 'bot' && (
            <Badge variant="outline" className="mt-0.5 border-white/20 text-[10px] capitalize text-white/70">
              {config.botDifficulty} bot
            </Badge>
          )}
        </div>
        <PlayerCard
          name={players[1].name}
          rating={ratings[players[1].name] ?? null}
          group={rules.groups[1]}
          remaining={remaining(rules.groups[1])}
          active={rules.turn === 1 && !over}
          isMe={config.mode !== 'local' ? seat === 1 : false}
          onBreak={rules.phase === 'break' && rules.turn === 1}
        />
      </div>

      {/* message strip */}
      <div className="flex min-h-[28px] items-center justify-center px-3 py-1 text-center text-xs font-medium text-emerald-200/90 sm:text-sm">
        {over ? (
          <span className="font-semibold text-amber-300">{players[rules.winner ?? 0].name} wins — {rules.winReason}</span>
        ) : rules.foul && rules.foulReason ? (
          <span className="text-red-300">{rules.foulReason} — ball in hand</span>
        ) : rules.message ? (
          <span>{rules.message}</span>
        ) : rules.ballInHand ? (
          <span className="text-emerald-200/80">Ball in hand — tap the table to place the cue ball</span>
        ) : (
          <span className="text-white/60">
            {players[rules.turn].name}&apos;s turn — press &amp; drag away from your target to pull the cue back (farther = more power), release to strike
          </span>
        )}
      </div>

      {/* table */}
      <div className="relative min-h-0 flex-1 px-1 pb-1 sm:px-3 sm:pb-3">
        <PoolTable
          gameRef={gameRefStable}
          interactive={myTurnInteractive}
          ballInHand={rules.ballInHand && myTurnInteractive}
          kitchenOnly={rules.kitchenOnly}
          onShoot={handleShoot}
          onPlaceCue={handlePlaceCue}
        />
        {config.mode === 'online' && !synced && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <p className="text-sm text-white/80">Syncing table with host…</p>
            </div>
          </div>
        )}
        {config.mode === 'bot' && rules.turn === 1 && !over && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white/85">
            {players[1].name} is thinking…
          </div>
        )}
        {chatBubble && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm text-white">
            {chatBubble}
          </div>
        )}
      </div>

      {/* bottom controls */}
      <div className="flex items-center justify-between gap-2 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" size="sm" onClick={toggleMute} aria-label={mutedState ? 'Unmute' : 'Mute'} className="text-white/70 hover:text-white">
          {mutedState ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          <span className="ml-1">{mutedState ? 'Muted' : 'Sound'}</span>
        </Button>
        {config.mode === 'online' && (
          <div className="flex gap-1.5">
            {['Nice shot!', 'Good luck!', 'Oops...'].map((preset) => (
              <Button
                key={preset}
                variant="outline"
                size="sm"
                className="h-7 border-white/15 bg-black/30 px-2 text-[11px] text-white/80 hover:bg-black/50"
                onClick={() => getSocket().emit('chat-quick', { preset })}
              >
                {preset}
              </Button>
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => setConfirmExit(true)} className="text-white/70 hover:text-white">
          {config.mode === 'local' ? 'End game' : 'Leave'}
        </Button>
      </div>

      {/* exit confirm */}
      <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialogContent className="bg-[#122b20] text-white sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this game?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">
              The current match will be abandoned and won&apos;t be recorded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent text-white hover:bg-white/10">Stay</AlertDialogCancel>
            <AlertDialogAction onClick={handleExit} className="bg-red-600 hover:bg-red-700">
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* opponent left */}
      <AlertDialog open={!!opponentLeft} onOpenChange={(o) => !o && setOpponentLeft(null)}>
        <AlertDialogContent className="bg-[#122b20] text-white sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Opponent left</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">{opponentLeft}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="hidden" />
            <AlertDialogAction onClick={handleExit} className="bg-emerald-600 hover:bg-emerald-700">
              Back to menu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* rematch offer */}
      <AlertDialog open={!!rematchOffer} onOpenChange={(o) => !o && setRematchOffer(null)}>
        <AlertDialogContent className="bg-[#122b20] text-white sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Rematch?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">{rematchOffer} wants a rematch.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent text-white hover:bg-white/10">Decline</AlertDialogCancel>
            <AlertDialogAction onClick={acceptRematch} className="bg-emerald-600 hover:bg-emerald-700">
              Accept
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* game over */}
      <Dialog open={!!gameOver && !opponentLeft}>
        <DialogContent className="border-white/10 bg-[#122b20] text-white sm:max-w-md">
          {gameOver && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Trophy className="h-6 w-6 text-amber-400" /> {players[gameOver.winner].name} wins!
                </DialogTitle>
                <DialogDescription className="text-white/70">{gameOver.reason}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 rounded-lg bg-black/20 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">Balls potted</span>
                  <span>
                    {players[0].name}: <b>{pottedByRef.current[0]}</b> · {players[1].name}: <b>{pottedByRef.current[1]}</b>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Duration</span>
                  <span>{Math.max(1, Math.round((Date.now() - startRef.current) / 1000))}s</span>
                </div>
                {config.mode !== 'local' && gameOver.record?.myDelta !== null && config.mode === 'bot' && (
                  <div className="flex justify-between text-emerald-300">
                    <span>Rating change</span>
                    <span>
                      {gameOver.record?.newRating} ({gameOver.record && gameOver.record.myDelta! >= 0 ? '+' : ''}
                      {gameOver.record?.myDelta})
                    </span>
                  </div>
                )}
                {config.mode === 'online' && (
                  <div className="text-emerald-300/90 text-xs">Match recorded — check the leaderboard.</div>
                )}
              </div>
              <DialogFooter className="flex-row gap-2 sm:justify-between">
                <Button variant="outline" onClick={onViewLeaderboard} className="flex-1 border-white/20 bg-transparent text-white hover:bg-white/10">
                  Leaderboard
                </Button>
                <Button variant="outline" onClick={handleExit} className="flex-1 border-white/20 bg-transparent text-white hover:bg-white/10">
                  Menu
                </Button>
                {config.mode !== 'online' ? (
                  <Button onClick={handleRematch} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                    Rematch
                  </Button>
                ) : (
                  <Button onClick={handleRematch} disabled={waitingRematch} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                    {waitingRematch ? 'Waiting…' : 'Rematch'}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PlayerCard({
  name,
  rating,
  group,
  remaining,
  active,
  isMe,
  onBreak,
}: {
  name: string
  rating: number | null
  group: Group | null
  remaining: number
  active: boolean
  isMe: boolean
  onBreak: boolean
}) {
  return (
    <div
      className={`flex flex-1 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors sm:px-3 ${
        active ? 'border-amber-300/70 bg-amber-300/10 shadow-[0_0_14px_rgba(252,211,77,0.15)]' : 'border-white/10 bg-white/5'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold sm:text-sm">{name}</span>
          {isMe && <span className="rounded bg-emerald-500/25 px-1 text-[9px] font-bold uppercase text-emerald-300">You</span>}
          {onBreak && active && <span className="rounded bg-white/15 px-1 text-[9px] font-bold uppercase text-white/70">Break</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/55 sm:text-[11px]">
          {rating !== null && <span>{rating} pts</span>}
          {group ? (
            <span className="capitalize">{group}s · {remaining} left</span>
          ) : (
            <span>{active ? 'Open table' : '—'}</span>
          )}
        </div>
      </div>
      <BallRow group={group} remaining={remaining} />
    </div>
  )
}

function BallRow({ group, remaining }: { group: Group | null; remaining: number }) {
  if (!group) return <div className="w-3" />
  const total = 7
  return (
    <div className="flex w-9 flex-wrap gap-[3px] sm:w-12">
      {Array.from({ length: total }, (_, i) => (
        <Ball key={i} id={group === 'solid' ? i + 1 : i + 9} tiny faded={i >= remaining} />
      ))}
    </div>
  )
}

function TinyBall({ id, tiny, faded }: { id: number; tiny?: boolean; faded?: boolean }) {
  void tiny
  const colors: Record<number, string> = {
    1: '#e8b323', 2: '#1c53c4', 3: '#d0342c', 4: '#6d3aa8', 5: '#e2762a', 6: '#1e7d46', 7: '#8c2c25',
    9: '#e8b323', 10: '#1c53c4', 11: '#d0342c', 12: '#6d3aa8', 13: '#e2762a', 14: '#1e7d46', 15: '#8c2c25',
  }
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full border border-black/40 sm:h-3 sm:w-3 ${faded ? 'opacity-25' : ''}`}
      style={{ backgroundColor: colors[id] ?? '#888' }}
    />
  )
}

const Ball = TinyBall

function makePlayers(config: GameConfig, playerName: string, playerTwoName: string): [PlayerInfo, PlayerInfo] {
  if (config.mode === 'bot') {
    const difficulty = config.botDifficulty ?? 'medium'
    return [
      { name: playerName || 'You', isBot: false },
      { name: BOT_NAMES[difficulty] ?? 'Bot', isBot: true, difficulty },
    ]
  }
  if (config.mode === 'online') {
    return [
      { name: playerName || 'You', isBot: false },
      { name: config.online!.opponentName || 'Opponent', isBot: false },
    ]
  }
  return [
    { name: playerName || 'Player 1', isBot: false },
    { name: playerTwoName || 'Player 2', isBot: false },
  ]
}

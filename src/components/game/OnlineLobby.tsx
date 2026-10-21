'use client'

// Online lobby: create / join / quick match with live connection state.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Loader2, LogIn, Shuffle, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { disconnectSocket, getSocket } from '@/lib/game/net'

interface OnlineLobbyProps {
  playerName: string
  onBack: () => void
  onMatched: (info: { seat: 0 | 1; roomCode: string; opponentName: string }) => void
}

type Phase = 'idle' | 'waiting-room' | 'queued' | 'error'

export default function OnlineLobby({ playerName, onBack, onMatched }: OnlineLobbyProps) {
  const { toast } = useToast()
  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [statusText, setStatusText] = useState('')
  const registeredRef = useRef(false)

  useEffect(() => {
    const s = getSocket()
    const onConnect = () => {
      setConnected(true)
      if (!registeredRef.current) {
        registeredRef.current = true
        s.emit('register', { name: playerName || 'Anonymous' })
      }
    }
    const onDisconnect = () => setConnected(false)
    const onRoomCreated = (d: { code: string }) => {
      setRoomCode(d.code)
      setPhase('waiting-room')
      setStatusText('Waiting for an opponent to join…')
    }
    const onRoomJoined = (d: { code: string; opponent: string }) => {
      toast({ title: `Joined ${d.code}`, description: `Opponent: ${d.opponent}` })
    }
    const onMatchFound = (d: { code: string; seat: 0 | 1; opponent: string }) => {
      onMatched({ seat: d.seat, roomCode: d.code, opponentName: d.opponent })
    }
    const onQueued = (d: { position: number }) => {
      setPhase('queued')
      setStatusText(`Searching for an opponent… (#${d.position})`)
    }
    const onErrorMsg = (d: { message: string }) => {
      toast({ title: 'Error', description: d.message, variant: 'destructive' })
      setPhase('idle')
      setStatusText('')
    }

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    s.on('room-created', onRoomCreated)
    s.on('room-joined', onRoomJoined)
    s.on('match-found', onMatchFound)
    s.on('queued', onQueued)
    s.on('error-msg', onErrorMsg)
    const t = setTimeout(() => {
      if (s.connected) {
        setConnected(true)
        if (!registeredRef.current) {
          registeredRef.current = true
          s.emit('register', { name: playerName || 'Anonymous' })
        }
      }
    }, 0)

    return () => {
      clearTimeout(t)
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.off('room-created', onRoomCreated)
      s.off('room-joined', onRoomJoined)
      s.off('match-found', onMatchFound)
      s.off('queued', onQueued)
      s.off('error-msg', onErrorMsg)
    }
  }, [onMatched, playerName, toast])

  const createRoom = useCallback(() => {
    getSocket().emit('create-room')
    setPhase('waiting-room')
    setStatusText('Creating room…')
  }, [])

  const joinRoom = useCallback(() => {
    const code = joinCode.trim().toUpperCase()
    if (code.length < 3) {
      toast({ title: 'Enter a room code', variant: 'destructive' })
      return
    }
    getSocket().emit('join-room', { code })
    setPhase('waiting-room')
    setStatusText(`Joining ${code}…`)
  }, [joinCode, toast])

  const quickMatch = useCallback(() => {
    getSocket().emit('quick-match')
    setPhase('queued')
    setStatusText('Searching for an opponent…')
  }, [])

  const cancelQueue = useCallback(() => {
    getSocket().emit('cancel-queue')
    setPhase('idle')
    setStatusText('')
  }, [])

  const copyCode = useCallback(() => {
    void navigator.clipboard?.writeText(roomCode)
    toast({ title: 'Copied', description: `Room code ${roomCode} copied` })
  }, [roomCode, toast])

  const goBack = useCallback(() => {
    const s = getSocket()
    if (phase === 'queued') s.emit('cancel-queue')
    if (phase === 'waiting-room') s.emit('leave-room')
    disconnectSocket()
    onBack()
  }, [onBack, phase])

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[radial-gradient(ellipse_at_top,#134e35_0%,#0c1f17_60%)] text-white">
      <div className="mx-auto w-full max-w-md flex-1 px-5 py-6">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 text-white/70 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Menu
          </Button>
          <span className={`flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-300' : 'text-red-300'}`}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>

        <h1 className="mb-1 text-2xl font-black">Online Multiplayer</h1>
        <p className="mb-6 text-sm text-white/55">Playing as <b className="text-white/80">{playerName || 'Anonymous'}</b></p>

        {/* waiting / queued status */}
        {phase !== 'idle' && (
          <Card className="mb-5 border-amber-300/30 bg-amber-300/5">
            <CardContent className="flex items-center gap-3 p-4">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{statusText}</p>
                {phase === 'waiting-room' && roomCode && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-lg bg-black/40 px-3 py-1.5 font-mono text-2xl font-bold tracking-[0.3em] text-amber-200">
                      {roomCode}
                    </span>
                    <Button variant="outline" size="sm" onClick={copyCode} className="border-white/25 bg-black/30 text-white/85 hover:bg-black/50">
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={cancelQueue} className="text-white/50">
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          <Card className="border-white/10 bg-white/5">
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold">Quick match</p>
              <p className="mb-3 text-xs text-white/50">Get matched with the next available player instantly.</p>
              <Button onClick={quickMatch} disabled={!connected || phase !== 'idle'} className="w-full bg-emerald-600 hover:bg-emerald-700">
                <Shuffle className="h-4 w-4" /> Find opponent
              </Button>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold">Create private room</p>
              <p className="mb-3 text-xs text-white/50">Get a 4-letter code and share it with a friend.</p>
              <Button onClick={createRoom} disabled={!connected || phase !== 'idle'} variant="outline" className="w-full border-white/20 bg-transparent text-white hover:bg-white/10">
                Create room
              </Button>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold">Join with code</p>
              <div className="flex gap-2">
                <Input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="ABCD"
                  className="border-white/15 bg-black/25 text-center font-mono text-xl font-bold tracking-[0.3em] text-white placeholder:text-white/25"
                  maxLength={4}
                  onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                />
                <Button onClick={joinRoom} disabled={!connected || phase !== 'idle'} className="bg-amber-500 text-black hover:bg-amber-400">
                  <LogIn className="h-4 w-4" /> Join
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/35">
          Tip: open this page on another device, or share the room code with a friend.
          The match is turn-based — both players see the same table in real time.
        </p>
      </div>
    </div>
  )
}

'use client'

// Root app: screen state machine (menu / game / lobby / leaderboard).
import { useCallback, useEffect, useState } from 'react'
import GameScreen, { type GameConfig } from '@/components/game/GameScreen'
import Leaderboard from '@/components/game/Leaderboard'
import Menu from '@/components/game/Menu'
import OnlineLobby from '@/components/game/OnlineLobby'

type Screen = 'menu' | 'game' | 'online' | 'leaderboard'

const NAME_KEY = 'pool-player-name'

export default function Home() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [playerName, setPlayerName] = useState('')
  const [playerTwoName] = useState('Player 2')
  const [config, setConfig] = useState<GameConfig | null>(null)
  const [gameKey, setGameKey] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      let saved = window.localStorage.getItem(NAME_KEY) ?? ''
      if (!saved) {
        // stable per-client guest name so leaderboard entries stay unique
        saved = `Guest-${Math.floor(1000 + Math.random() * 9000)}`
        window.localStorage.setItem(NAME_KEY, saved)
      }
      setPlayerName(saved)
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const saveName = useCallback((name: string) => {
    setPlayerName(name)
    window.localStorage.setItem(NAME_KEY, name)
  }, [])

  const effectiveName = playerName.trim()

  const playBot = useCallback(
    (difficulty: 'easy' | 'medium' | 'hard') => {
      setConfig({ mode: 'bot', botDifficulty: difficulty })
      setGameKey((k) => k + 1)
      setScreen('game')
    },
    []
  )

  const playLocal = useCallback(() => {
    setConfig({ mode: 'local' })
    setGameKey((k) => k + 1)
    setScreen('game')
  }, [])

  const onMatched = useCallback((info: { seat: 0 | 1; roomCode: string; opponentName: string }) => {
    setConfig({ mode: 'online', online: info })
    setGameKey((k) => k + 1)
    setScreen('game')
  }, [])

  const exitGame = useCallback(() => {
    setConfig(null)
    setScreen('menu')
  }, [])

  const onMatchRecorded = useCallback(() => setRefreshKey((k) => k + 1), [])

  const openLeaderboard = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setScreen('leaderboard')
  }, [])

  if (screen === 'game' && config) {
    return (
      <GameScreen
        key={`${config.mode}-${gameKey}`}
        playerName={effectiveName}
        playerTwoName={playerTwoName}
        config={config}
        onExit={exitGame}
        onViewLeaderboard={openLeaderboard}
        onMatchRecorded={onMatchRecorded}
      />
    )
  }

  if (screen === 'online') {
    return <OnlineLobby playerName={effectiveName} onBack={() => setScreen('menu')} onMatched={onMatched} />
  }

  if (screen === 'leaderboard') {
    return <Leaderboard playerName={effectiveName} onBack={() => setScreen('menu')} refreshKey={refreshKey} />
  }

  return (
    <Menu
      playerName={playerName}
      onNameChange={saveName}
      onPlayBot={playBot}
      onLocal={playLocal}
      onOnline={() => setScreen('online')}
      onLeaderboard={openLeaderboard}
    />
  )
}

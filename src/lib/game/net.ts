'use client'

// Typed socket.io client for online matches (via Caddy gateway, port 3003).
import { io, type Socket } from 'socket.io-client'
import type { Ball, RulesState } from './constants'

export interface WireBall {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  active: boolean
  sinking?: number
  sinkPocket?: number
}

export interface WireState {
  balls: WireBall[]
  rules: RulesState
  players: [{ name: string; isBot: boolean }, { name: string; isBot: boolean }]
}

export type NetStatus = 'idle' | 'connecting' | 'queued' | 'waiting' | 'playing' | 'error'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
  }
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export interface GameSyncPayload {
  balls: Ball[]
  rules: RulesState
  lastShot?: { shooter: 0 | 1; potted: number[]; foul: boolean; foulReason: string | null }
}

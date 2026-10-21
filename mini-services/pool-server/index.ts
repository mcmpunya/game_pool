import { createServer } from 'http'
import { Server, type Socket } from 'socket.io'

// Turn-based relay service for online 8-ball matches.
// The room host is authoritative: both clients simulate shots locally for
// animation, and the host broadcasts the authoritative result after each shot.

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface Room {
  code: string
  host: Socket | null
  guest: Socket | null
  created: number
  lastActivity: number
}

const rooms = new Map<string, Room>()
const queue: Socket[] = []
const roomOf = new Map<string, string>() // socket.id -> room code

function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return rooms.has(code) ? genCode() : code
}

function seatName(s: Socket | null): string {
  return (s?.data as { name?: string } | undefined)?.name ?? 'Anonymous'
}

function opponentOf(room: Room, s: Socket): Socket | null {
  if (room.host?.id === s.id) return room.guest
  if (room.guest?.id === s.id) return room.host
  return null
}

function leaveRoom(socket: Socket, notify: boolean) {
  const code = roomOf.get(socket.id)
  if (!code) return
  const room = rooms.get(code)
  roomOf.delete(socket.id)
  if (!room) return
  const isHost = room.host?.id === socket.id
  if (isHost) room.host = null
  else if (room.guest?.id === socket.id) room.guest = null

  const opp = room.host ?? room.guest
  if (notify && opp) {
    opp.emit('opponent-left', { message: `${seatName(socket)} left the match` })
  }
  // keep the room for the remaining player so they can host a new opponent
  if (!room.host && !room.guest) rooms.delete(code)
  console.log(`[room ${code}] ${seatName(socket)} left (${rooms.size} rooms)`)
}

function tryMatchQueue() {
  while (queue.length >= 2) {
    const a = queue.shift()!
    const b = queue.shift()!
    if (!a.connected || !b.connected) {
      if (a.connected) queue.unshift(a)
      if (b.connected) queue.unshift(b)
      continue
    }
    const code = genCode()
    const room: Room = { code, host: a, guest: b, created: Date.now(), lastActivity: Date.now() }
    rooms.set(code, room)
    roomOf.set(a.id, code)
    roomOf.set(b.id, code)

    a.emit('match-found', { code, seat: 0, opponent: seatName(b) })
    b.emit('match-found', { code, seat: 1, opponent: seatName(a) })
    console.log(`[quick-match] ${seatName(a)} vs ${seatName(b)} in room ${code}`)
  }
}

io.on('connection', (socket) => {
  console.log(`connected: ${socket.id}`)

  socket.on('register', (data: { name?: string }) => {
    const name = String(data?.name ?? 'Anonymous').slice(0, 24)
    ;(socket.data as { name?: string }).name = name
    socket.emit('registered', { name })
  })

  socket.on('create-room', () => {
    leaveRoom(socket, true)
    // remove from queue if queued
    const qi = queue.indexOf(socket)
    if (qi >= 0) queue.splice(qi, 1)
    const code = genCode()
    const room: Room = { code, host: socket, guest: null, created: Date.now(), lastActivity: Date.now() }
    rooms.set(code, room)
    roomOf.set(socket.id, code)
    socket.emit('room-created', { code, seat: 0 })
    console.log(`[room ${code}] created by ${seatName(socket)}`)
  })

  socket.on('join-room', (data: { code?: string }) => {
    const code = String(data?.code ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) {
      socket.emit('error-msg', { message: `Room "${code || '???'}" not found` })
      return
    }
    if (room.guest) {
      socket.emit('error-msg', { message: 'Room is full' })
      return
    }
    const qi = queue.indexOf(socket)
    if (qi >= 0) queue.splice(qi, 1)
    leaveRoom(socket, true)

    room.guest = socket
    room.lastActivity = Date.now()
    roomOf.set(socket.id, code)
    socket.emit('room-joined', { code, seat: 1, opponent: seatName(room.host) })
    room.host?.emit('opponent-joined', { opponent: seatName(socket) })
    // kick both clients into the match screen
    socket.emit('match-found', { code, seat: 1, opponent: seatName(room.host) })
    room.host?.emit('match-found', { code, seat: 0, opponent: seatName(socket) })
    console.log(`[room ${code}] ${seatName(socket)} joined`)
  })

  // guest asks for the authoritative initial state once its game screen is up
  socket.on('guest-ready', () => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room || room.guest?.id !== socket.id) return
    room.host?.emit('guest-ready')
  })

  socket.on('quick-match', () => {
    if (queue.includes(socket) || roomOf.has(socket.id)) return
    queue.push(socket)
    socket.emit('queued', { position: queue.length })
    tryMatchQueue()
  })

  socket.on('cancel-queue', () => {
    const qi = queue.indexOf(socket)
    if (qi >= 0) queue.splice(qi, 1)
    socket.emit('queue-cancelled', {})
  })

  // --- host sends the initial rack + state when both players are present ---
  socket.on('host-state', (data: unknown) => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room || room.host?.id !== socket.id) return
    room.lastActivity = Date.now()
    room.guest?.emit('game-start', data)
  })

  socket.on('start-match', () => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    room.lastActivity = Date.now()
    io.to(room.host?.id ?? '').emit('begin-match', { seat: 0 })
    room.guest?.emit('begin-match', { seat: 1 })
  })

  // --- shot commands (shooter -> opponent) ---
  socket.on('shot', (data: unknown) => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    room.lastActivity = Date.now()
    const opp = opponentOf(room, socket)
    opp?.emit('opponent-shot', data)
  })

  // --- authoritative post-shot sync (host -> guest) ---
  socket.on('shot-result', (data: unknown) => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room || room.host?.id !== socket.id) return
    room.lastActivity = Date.now()
    room.guest?.emit('game-sync', data)
  })

  socket.on('place-cue', (data: unknown) => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    const opp = opponentOf(room, socket)
    opp?.emit('cue-placed', data)
  })

  // --- rematch ---
  socket.on('rematch-offer', () => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    const opp = opponentOf(room, socket)
    opp?.emit('rematch-offered', { from: seatName(socket) })
  })

  socket.on('rematch-accept', () => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    const opp = opponentOf(room, socket)
    opp?.emit('rematch-started', {})
    socket.emit('rematch-started', {})
  })

  socket.on('chat-quick', (data: { preset?: string }) => {
    const code = roomOf.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    const allowed = ['Nice shot!', 'Good luck!', 'Close one!', 'Well played', 'Oops...']
    const text = allowed.includes(data?.preset ?? '') ? data!.preset! : null
    if (!text) return
    const opp = opponentOf(room, socket)
    opp?.emit('chat', { from: seatName(socket), text })
  })

  socket.on('leave-room', () => leaveRoom(socket, true))

  socket.on('disconnect', () => {
    const qi = queue.indexOf(socket)
    if (qi >= 0) queue.splice(qi, 1)
    leaveRoom(socket, true)
    console.log(`disconnected: ${socket.id}`)
  })

  socket.on('error', (err) => console.error(`socket error ${socket.id}:`, err))
})

// sweep stale rooms (both seats empty) every 2 minutes
setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (!room.host && !room.guest && now - room.lastActivity > 120000) rooms.delete(code)
  }
}, 120000)

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`Pool multiplayer server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})

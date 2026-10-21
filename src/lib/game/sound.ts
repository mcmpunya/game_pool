// Tiny WebAudio synth for game sounds — no audio assets needed.
let ctx: AudioContext | null = null
let muted = false

export function setMuted(m: boolean) {
  muted = m
}

export function isMuted() {
  return muted
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function unlockAudio() {
  ac()
}

function noiseBuffer(c: AudioContext, dur: number) {
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Ball-ball click. speed 0..600 */
export function playBallHit(speed: number) {
  const c = ac()
  if (!c || muted) return
  const vol = Math.min(1, 0.12 + speed / 500)
  const t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, 0.03)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 2200 + speed * 3
  filter.Q.value = 6
  const g = c.createGain()
  g.gain.setValueAtTime(vol * 0.7, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t)
}

/** Cushion thud. */
export function playCushion(speed: number) {
  const c = ac()
  if (!c || muted) return
  const vol = Math.min(1, 0.06 + speed / 800)
  const t = c.currentTime
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(160, t)
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.08)
  const g = c.createGain()
  g.gain.setValueAtTime(vol * 0.5, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
  osc.connect(g).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.1)
}

/** Pocket drop. */
export function playPocket() {
  const c = ac()
  if (!c || muted) return
  const t = c.currentTime
  const osc = c.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(420, t)
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.22)
  const g = c.createGain()
  g.gain.setValueAtTime(0.35, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
  osc.connect(g).connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.26)
}

/** Cue strike. */
export function playCueStrike(power: number) {
  const c = ac()
  if (!c || muted) return
  const vol = Math.min(1, 0.15 + power / 500)
  const t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, 0.05)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 1400
  const g = c.createGain()
  g.gain.setValueAtTime(vol * 0.6, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
  src.connect(filter).connect(g).connect(c.destination)
  src.start(t)
}

/** Win chime. */
export function playWin() {
  const c = ac()
  if (!c || muted) return
  const t = c.currentTime
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f
    const g = c.createGain()
    const start = t + i * 0.13
    g.gain.setValueAtTime(0.0, start)
    g.gain.linearRampToValueAtTime(0.22, start + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.5)
    osc.connect(g).connect(c.destination)
    osc.start(start)
    osc.stop(start + 0.55)
  })
}

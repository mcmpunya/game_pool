'use client'

// Registers the service worker and shows an "Install app" button when the
// browser supports PWA install (beforeinstallprompt). iOS falls back to a hint.
import { useCallback, useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function PwaInstallButton() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    const t = setTimeout(() => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
      if (standalone) setInstalled(true)

      const ua = window.navigator.userAgent
      setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream)
    }, 0)

    const onBIP = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BIPEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBIP)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      clearTimeout(t)
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (deferred) {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') setInstalled(true)
      setDeferred(null)
    } else if (isIOS) {
      setShowHint((s) => !s)
    }
  }, [deferred, isIOS])

  if (installed) return null

  if (!deferred && !isIOS) return null

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void install()}
        className="border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
      >
        {isIOS ? <Share className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        <span className="ml-1">{isIOS ? 'Add to Home Screen' : 'Install app'}</span>
      </Button>
      {showHint && isIOS && (
        <p className="absolute bottom-full left-0 mb-2 w-56 rounded-lg bg-black/85 p-2.5 text-[11px] leading-snug text-white/85">
          In Safari: tap <b>Share</b>, then <b>Add to Home Screen</b> — the game installs like an app, no store needed.
        </p>
      )}
    </div>
  )
}

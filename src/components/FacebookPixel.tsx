// src/components/FacebookPixel.tsx
'use client'
import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

declare global {
  interface Window {
    fbq: any
  }
}

export default function FacebookPixel() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID

    if (!pixelId) {
      console.warn('[FB Pixel] Pixel ID mancante')
      return
    }

    // Inizializza Pixel
    if (!window.fbq) {
      window.fbq = function() {
        window.fbq.callMethod 
          ? window.fbq.callMethod.apply(window.fbq, arguments) 
          : window.fbq.queue.push(arguments)
      }
      window.fbq.queue = []
      window.fbq.loaded = true
      window.fbq.version = '2.0'

      const script = document.createElement('script')
      script.async = true
      script.src = 'https://connect.facebook.net/en_US/fbevents.js'
      document.head.appendChild(script)
    }

    window.fbq('init', pixelId)
    window.fbq('track', 'PageView')

    // Salva fbclid nei cookie
    const fbclid = searchParams.get('fbclid')
    if (fbclid) {
      document.cookie = `_fbc=fb.1.${Date.now()}.${fbclid}; path=/; max-age=7776000` // 90 giorni
    }

    console.log('[FB Pixel] ✅ Inizializzato')
  }, [pathname, searchParams])

  return null
}

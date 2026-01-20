// src/components/FacebookPixel.tsx
'use client'

import Script from 'next/script'

export default function FacebookPixel() {
  const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID

  if (!pixelId) {
    console.warn('[FB Pixel] ⚠️ NEXT_PUBLIC_FB_PIXEL_ID mancante in .env.local')
    return null
  }

  return (
    <>
      {/* 🔥 Script principale Facebook Pixel */}
      <Script
        id="facebook-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            
            fbq('init', '${pixelId}');
            fbq('track', 'PageView');
            
            console.log('[FB Pixel] ✅ Inizializzato - ID: ${pixelId}');
          `,
        }}
      />

      {/* 🔥 Script per salvare fbclid (tracking parametro Facebook) */}
      <Script
        id="facebook-fbclid"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                const urlParams = new URLSearchParams(window.location.search);
                const fbclid = urlParams.get('fbclid');
                if (fbclid) {
                  const cookieValue = 'fb.1.' + Date.now() + '.' + fbclid;
                  document.cookie = '_fbc=' + cookieValue + '; path=/; max-age=7776000; SameSite=Lax; Secure';
                  console.log('[FB Pixel] 📌 fbclid salvato:', fbclid);
                }
                
                // Salva anche fbp se presente
                const fbp = urlParams.get('_fbp');
                if (fbp) {
                  document.cookie = '_fbp=' + fbp + '; path=/; max-age=7776000; SameSite=Lax; Secure';
                  console.log('[FB Pixel] 📌 _fbp salvato:', fbp);
                }
              } catch (e) {
                console.error('[FB Pixel] Errore salvataggio fbclid:', e);
              }
            })();
          `,
        }}
      />
    </>
  )
}

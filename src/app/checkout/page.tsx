// src/app/checkout/page.tsx — RiPhone Checkout
"use client"

import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  ChangeEvent,
  FormEvent,
  Suspense,
} from "react"
import { useSearchParams } from "next/navigation"
import Script from "next/script"
import { loadStripe, Stripe } from "@stripe/stripe-js"
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js"

export const dynamic = "force-dynamic"

// ─── TYPES ───────────────────────────────────────────────────────────────────

type CheckoutItem = {
  id: string | number
  title: string
  variantTitle?: string
  quantity: number
  priceCents?: number
  linePriceCents?: number
  image?: string
}

type CartSessionResponse = {
  sessionId: string
  currency: string
  items: CheckoutItem[]
  subtotalCents?: number
  shippingCents?: number
  totalCents?: number
  paymentIntentClientSecret?: string
  paymentIntentId?: string
  rawCart?: any
  shopDomain?: string
  error?: string
}

type CustomerForm = {
  fullName: string
  email: string
  phone: string
  address1: string
  address2: string
  city: string
  postalCode: string
  province: string
  countryCode: string
}

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────

type Lang = "it" | "de" | "fr" | "es" | "en" | "nl" | "pt"

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  it: {
    loading: "Caricamento pagamento...",
    loadError: "Impossibile caricare l'ordine",
    backToCart: "← Torna al carrello",
    securePayment: "Pagamento Sicuro",
    sslSecure: "SSL Sicuro",
    freeShipping: "Spedizione GRATUITA",
    freeShippingSubt: "24–48h Tutta Europa",
    easyReturn: "Reso Facile",
    easyReturnSubt: "Entro 14 giorni",
    support: "Supporto",
    supportSubt: "7 giorni su 7",
    showOrder: "Mostra riepilogo ordine",
    hideOrder: "Nascondi riepilogo ordine",
    contactInfo: "Informazioni di Contatto",
    fullName: "Nome e Cognome",
    email: "Email",
    phone: "Telefono",
    shippingAddress: "Indirizzo di Spedizione",
    address1: "Via e numero civico",
    address2: "Appartamento, interno (opzionale)",
    city: "Città",
    province: "Provincia",
    postalCode: "CAP",
    country: "Paese",
    differentBilling: "Usa un indirizzo di fatturazione diverso",
    billingAddress: "Indirizzo di Fatturazione",
    payment: "Pagamento",
    payNow: "Paga ora",
    processing: "Elaborazione...",
    orderSuccess: "✅ Ordine confermato! Reindirizzamento...",
    subtotal: "Subtotale",
    discount: "Sconto",
    shipping: "Spedizione (Europa)",
    free: "GRATIS",
    total: "Totale",
    saving: "🎉 Stai Risparmiando!",
    reviews: "recensioni",
    lastPurchase: "Ultimo acquisto:",
    minutesAgo: "minuti fa",
    reconditioned: "Ricondizionato Certificato",
    warranty: "Garanzia 12 Mesi",
    certified: "Apple Certificato",
    fillRequired: "Compila tutti i campi obbligatori",
    stripeNotReady: "Sistema di pagamento non pronto",
    piNotCreated: "Pagamento non inizializzato. Compila l'indirizzo.",
    calcShipping: "Calcolo totale...",
    errorPayment: "Errore nel pagamento",
  },
  de: {
    loading: "Zahlung wird geladen...",
    loadError: "Bestellung kann nicht geladen werden",
    backToCart: "← Zurück zum Warenkorb",
    securePayment: "Sichere Zahlung",
    sslSecure: "SSL Sicher",
    freeShipping: "KOSTENLOSER Versand",
    freeShippingSubt: "24–48h Ganz Europa",
    easyReturn: "Einfache Rückgabe",
    easyReturnSubt: "Innerhalb 14 Tagen",
    support: "Support",
    supportSubt: "7 Tage die Woche",
    showOrder: "Bestellübersicht anzeigen",
    hideOrder: "Bestellübersicht ausblenden",
    contactInfo: "Kontaktinformationen",
    fullName: "Vor- und Nachname",
    email: "E-Mail",
    phone: "Telefon",
    shippingAddress: "Lieferadresse",
    address1: "Straße und Hausnummer",
    address2: "Wohnung, Etage (optional)",
    city: "Stadt",
    province: "Bundesland",
    postalCode: "PLZ",
    country: "Land",
    differentBilling: "Andere Rechnungsadresse verwenden",
    billingAddress: "Rechnungsadresse",
    payment: "Zahlung",
    payNow: "Jetzt bezahlen",
    processing: "Verarbeitung...",
    orderSuccess: "✅ Bestellung bestätigt! Weiterleitung...",
    subtotal: "Zwischensumme",
    discount: "Rabatt",
    shipping: "Versand (Europa)",
    free: "KOSTENLOS",
    total: "Gesamt",
    saving: "🎉 Sie sparen!",
    reviews: "Bewertungen",
    lastPurchase: "Letzter Kauf:",
    minutesAgo: "Minuten her",
    reconditioned: "Zertifiziert Generalüberholt",
    warranty: "12 Monate Garantie",
    certified: "Apple Zertifiziert",
    fillRequired: "Bitte alle Pflichtfelder ausfüllen",
    stripeNotReady: "Zahlungssystem nicht bereit",
    piNotCreated: "Zahlung nicht initialisiert. Adresse ausfüllen.",
    calcShipping: "Gesamtsumme wird berechnet...",
    errorPayment: "Zahlungsfehler",
  },
  fr: {
    loading: "Chargement du paiement...",
    loadError: "Impossible de charger la commande",
    backToCart: "← Retour au panier",
    securePayment: "Paiement Sécurisé",
    sslSecure: "SSL Sécurisé",
    freeShipping: "Livraison GRATUITE",
    freeShippingSubt: "24–48h Toute l'Europe",
    easyReturn: "Retours Faciles",
    easyReturnSubt: "Sous 14 jours",
    support: "Support",
    supportSubt: "7 jours sur 7",
    showOrder: "Afficher le récapitulatif",
    hideOrder: "Masquer le récapitulatif",
    contactInfo: "Informations de Contact",
    fullName: "Nom et Prénom",
    email: "Email",
    phone: "Téléphone",
    shippingAddress: "Adresse de Livraison",
    address1: "Rue et numéro",
    address2: "Appartement (optionnel)",
    city: "Ville",
    province: "Région",
    postalCode: "Code Postal",
    country: "Pays",
    differentBilling: "Utiliser une adresse de facturation différente",
    billingAddress: "Adresse de Facturation",
    payment: "Paiement",
    payNow: "Payer maintenant",
    processing: "Traitement...",
    orderSuccess: "✅ Commande confirmée ! Redirection...",
    subtotal: "Sous-total",
    discount: "Remise",
    shipping: "Livraison (Europe)",
    free: "GRATUIT",
    total: "Total",
    saving: "🎉 Vous économisez !",
    reviews: "avis",
    lastPurchase: "Dernier achat :",
    minutesAgo: "minutes",
    reconditioned: "Reconditionné Certifié",
    warranty: "Garantie 12 Mois",
    certified: "Certifié Apple",
    fillRequired: "Remplissez tous les champs obligatoires",
    stripeNotReady: "Système de paiement non prêt",
    piNotCreated: "Paiement non initialisé. Remplissez l'adresse.",
    calcShipping: "Calcul du total...",
    errorPayment: "Erreur de paiement",
  },
  es: {
    loading: "Cargando pago...",
    loadError: "No se puede cargar el pedido",
    backToCart: "← Volver al carrito",
    securePayment: "Pago Seguro",
    sslSecure: "SSL Seguro",
    freeShipping: "Envío GRATIS",
    freeShippingSubt: "24–48h Toda Europa",
    easyReturn: "Devoluciones Fáciles",
    easyReturnSubt: "En 14 días",
    support: "Soporte",
    supportSubt: "7 días a la semana",
    showOrder: "Ver resumen del pedido",
    hideOrder: "Ocultar resumen del pedido",
    contactInfo: "Información de Contacto",
    fullName: "Nombre y Apellidos",
    email: "Email",
    phone: "Teléfono",
    shippingAddress: "Dirección de Envío",
    address1: "Calle y número",
    address2: "Apartamento (opcional)",
    city: "Ciudad",
    province: "Provincia",
    postalCode: "Código Postal",
    country: "País",
    differentBilling: "Usar una dirección de facturación diferente",
    billingAddress: "Dirección de Facturación",
    payment: "Pago",
    payNow: "Pagar ahora",
    processing: "Procesando...",
    orderSuccess: "✅ ¡Pedido confirmado! Redirigiendo...",
    subtotal: "Subtotal",
    discount: "Descuento",
    shipping: "Envío (Europa)",
    free: "GRATIS",
    total: "Total",
    saving: "🎉 ¡Estás ahorrando!",
    reviews: "reseñas",
    lastPurchase: "Última compra:",
    minutesAgo: "minutos",
    reconditioned: "Reacondicionado Certificado",
    warranty: "Garantía 12 Meses",
    certified: "Certificado Apple",
    fillRequired: "Completa todos los campos obligatorios",
    stripeNotReady: "Sistema de pago no listo",
    piNotCreated: "Pago no inicializado. Rellena la dirección.",
    calcShipping: "Calculando total...",
    errorPayment: "Error de pago",
  },
  en: {
    loading: "Loading payment...",
    loadError: "Unable to load order",
    backToCart: "← Back to cart",
    securePayment: "Secure Payment",
    sslSecure: "SSL Secure",
    freeShipping: "FREE Shipping",
    freeShippingSubt: "24–48h All Europe",
    easyReturn: "Easy Returns",
    easyReturnSubt: "Within 14 days",
    support: "Support",
    supportSubt: "7 days a week",
    showOrder: "Show order summary",
    hideOrder: "Hide order summary",
    contactInfo: "Contact Information",
    fullName: "Full Name",
    email: "Email",
    phone: "Phone",
    shippingAddress: "Shipping Address",
    address1: "Street and number",
    address2: "Apartment (optional)",
    city: "City",
    province: "Province / State",
    postalCode: "Postal Code",
    country: "Country",
    differentBilling: "Use a different billing address",
    billingAddress: "Billing Address",
    payment: "Payment",
    payNow: "Pay now",
    processing: "Processing...",
    orderSuccess: "✅ Order confirmed! Redirecting...",
    subtotal: "Subtotal",
    discount: "Discount",
    shipping: "Shipping (Europe)",
    free: "FREE",
    total: "Total",
    saving: "🎉 You're saving!",
    reviews: "reviews",
    lastPurchase: "Last purchase:",
    minutesAgo: "minutes ago",
    reconditioned: "Certified Refurbished",
    warranty: "12 Month Warranty",
    certified: "Apple Certified",
    fillRequired: "Fill in all required fields",
    stripeNotReady: "Payment system not ready",
    piNotCreated: "Payment not initialized. Fill in the address.",
    calcShipping: "Calculating total...",
    errorPayment: "Payment error",
  },
  nl: {
    loading: "Betaling laden...",
    loadError: "Bestelling kan niet worden geladen",
    backToCart: "← Terug naar winkelwagen",
    securePayment: "Veilige Betaling",
    sslSecure: "SSL Beveiligd",
    freeShipping: "GRATIS Verzending",
    freeShippingSubt: "24–48u Heel Europa",
    easyReturn: "Eenvoudig Retourneren",
    easyReturnSubt: "Binnen 14 dagen",
    support: "Support",
    supportSubt: "7 dagen per week",
    showOrder: "Bestellingsoverzicht tonen",
    hideOrder: "Bestellingsoverzicht verbergen",
    contactInfo: "Contactgegevens",
    fullName: "Voor- en achternaam",
    email: "E-mail",
    phone: "Telefoon",
    shippingAddress: "Verzendadres",
    address1: "Straat en huisnummer",
    address2: "Appartement (optioneel)",
    city: "Stad",
    province: "Provincie",
    postalCode: "Postcode",
    country: "Land",
    differentBilling: "Ander factuuradres gebruiken",
    billingAddress: "Factuuradres",
    payment: "Betaling",
    payNow: "Nu betalen",
    processing: "Verwerking...",
    orderSuccess: "✅ Bestelling bevestigd! Doorsturen...",
    subtotal: "Subtotaal",
    discount: "Korting",
    shipping: "Verzending (Europa)",
    free: "GRATIS",
    total: "Totaal",
    saving: "🎉 U bespaart!",
    reviews: "beoordelingen",
    lastPurchase: "Laatste aankoop:",
    minutesAgo: "minuten geleden",
    reconditioned: "Gecertificeerd Gereviseerd",
    warranty: "12 Maanden Garantie",
    certified: "Apple Gecertificeerd",
    fillRequired: "Vul alle verplichte velden in",
    stripeNotReady: "Betalingssysteem niet gereed",
    piNotCreated: "Betaling niet geïnitialiseerd. Vul het adres in.",
    calcShipping: "Totaal berekenen...",
    errorPayment: "Betalingsfout",
  },
  pt: {
    loading: "A carregar pagamento...",
    loadError: "Impossível carregar encomenda",
    backToCart: "← Voltar ao carrinho",
    securePayment: "Pagamento Seguro",
    sslSecure: "SSL Seguro",
    freeShipping: "Envio GRÁTIS",
    freeShippingSubt: "24–48h Toda a Europa",
    easyReturn: "Devoluções Fáceis",
    easyReturnSubt: "Em 14 dias",
    support: "Suporte",
    supportSubt: "7 dias por semana",
    showOrder: "Mostrar resumo do pedido",
    hideOrder: "Ocultar resumo do pedido",
    contactInfo: "Informações de Contacto",
    fullName: "Nome e Apelido",
    email: "Email",
    phone: "Telefone",
    shippingAddress: "Morada de Entrega",
    address1: "Rua e número",
    address2: "Apartamento (opcional)",
    city: "Cidade",
    province: "Distrito",
    postalCode: "Código Postal",
    country: "País",
    differentBilling: "Usar morada de faturação diferente",
    billingAddress: "Morada de Faturação",
    payment: "Pagamento",
    payNow: "Pagar agora",
    processing: "A processar...",
    orderSuccess: "✅ Encomenda confirmada! A redirecionar...",
    subtotal: "Subtotal",
    discount: "Desconto",
    shipping: "Envio (Europa)",
    free: "GRÁTIS",
    total: "Total",
    saving: "🎉 Está a poupar!",
    reviews: "avaliações",
    lastPurchase: "Última compra:",
    minutesAgo: "minutos atrás",
    reconditioned: "Recondicionado Certificado",
    warranty: "Garantia 12 Meses",
    certified: "Certificado Apple",
    fillRequired: "Preencha todos os campos obrigatórios",
    stripeNotReady: "Sistema de pagamento não pronto",
    piNotCreated: "Pagamento não inicializado. Preencha a morada.",
    calcShipping: "A calcular total...",
    errorPayment: "Erro de pagamento",
  },
}

// Prefissi telefonici per paese
const PHONE_PREFIXES: Record<string, string> = {
  IT: "+39", DE: "+49", FR: "+33", ES: "+34", GB: "+44",
  NL: "+31", BE: "+32", AT: "+43", CH: "+41", PT: "+351",
  PL: "+48", SE: "+46", DK: "+45", NO: "+47", FI: "+358",
  GR: "+30", CZ: "+420", RO: "+40", HU: "+36", SK: "+421",
}

const COUNTRY_TO_LANG: Record<string, Lang> = {
  IT: "it", DE: "de", AT: "de", CH: "de",
  FR: "fr", BE: "fr",
  ES: "es",
  NL: "nl",
  PT: "pt",
  GB: "en", US: "en", AU: "en", CA: "en", IE: "en",
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function formatMoney(cents: number | undefined, currency: string = "EUR", lang: Lang = "it") {
  const value = (cents ?? 0) / 100
  const localeMap: Record<Lang, string> = {
    it: "it-IT", de: "de-DE", fr: "fr-FR", es: "es-ES",
    en: "en-GB", nl: "nl-NL", pt: "pt-PT",
  }
  return new Intl.NumberFormat(localeMap[lang], {
    style: "currency", currency, minimumFractionDigits: 2,
  }).format(value)
}

async function detectCountryFromIP(): Promise<string> {
  try {
    const res = await fetch("/api/geo", { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const data = await res.json()
      if (data?.country && /^[A-Z]{2}$/.test(data.country)) return data.country
    }
  } catch {}
  try {
    const res = await fetch("https://ipapi.co/country/", { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const country = (await res.text()).trim().toUpperCase()
      if (/^[A-Z]{2}$/.test(country)) return country
    }
  } catch {}
  const lang = navigator.language || ""
  const langMap: Record<string, string> = {
    "it": "IT", "it-IT": "IT", "de": "DE", "de-DE": "DE",
    "fr": "FR", "fr-FR": "FR", "es": "ES", "es-ES": "ES",
    "nl": "NL", "pt": "PT", "en-GB": "GB",
  }
  return langMap[lang] || "IT"
}

function buildCountryList(lang: Lang): { code: string; label: string }[] {
  const codes = [
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES",
    "SE","GB","CH","NO","IS","AL","BA","ME","MK","RS","TR","UA","BY",
    "MD","AM","GE","AZ","US","CA","AU","JP","CN","BR","IN","MX","AR",
  ]
  const localeMap: Record<Lang, string> = {
    it: "it", de: "de", fr: "fr", es: "es", en: "en", nl: "nl", pt: "pt",
  }
  try {
    const regionNames = new Intl.DisplayNames([localeMap[lang]], { type: "region" })
    return codes
      .map((code) => {
        try { const label = regionNames.of(code); return label ? { code, label } : null } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => a!.label.localeCompare(b!.label, localeMap[lang])) as { code: string; label: string }[]
  } catch {
    return codes.map((code) => ({ code, label: code })).sort((a, b) => a.label.localeCompare(b.label))
  }
}

// ─── CHECKOUT INNER ───────────────────────────────────────────────────────────

function CheckoutInner({ cart, sessionId }: { cart: CartSessionResponse; sessionId: string }) {
  const stripe = useStripe()
  const elements = useElements()

  const [lang, setLang] = useState<Lang>("it")
  const t = TRANSLATIONS[lang]

  const [customer, setCustomer] = useState<CustomerForm>({
    fullName: "", email: "", phone: "",
    address1: "", address2: "", city: "",
    postalCode: "", province: "", countryCode: "IT",
  })
  const [useDifferentBilling, setUseDifferentBilling] = useState(false)
  const [billingAddress, setBillingAddress] = useState<CustomerForm>({
    fullName: "", email: "", phone: "",
    address1: "", address2: "", city: "",
    postalCode: "", province: "", countryCode: "IT",
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [shippingError, setShippingError] = useState<string | null>(null)
  const [orderSummaryExpanded, setOrderSummaryExpanded] = useState(false)
  const [fbPixelSent, setFbPixelSent] = useState(false)
  const [countryDetecting, setCountryDetecting] = useState(true)
  const [calculatedShippingCents, setCalculatedShippingCents] = useState(0)
  const [lastCalculatedHash, setLastCalculatedHash] = useState<string>("")
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const scriptLoadedRef = useRef(false)

  const currency = (cart.currency || "EUR").toUpperCase()
  const COUNTRIES = useMemo(() => buildCountryList(lang), [lang])

  // Detect country + set lang
  useEffect(() => {
    setCountryDetecting(true)
    detectCountryFromIP().then((code) => {
      const detectedLang = COUNTRY_TO_LANG[code] || "it"
      const prefix = PHONE_PREFIXES[code] || ""
      setLang(detectedLang)
      setCustomer((prev) => ({
        ...prev,
        countryCode: code,
        phone: prefix,
      }))
      setBillingAddress((prev) => ({ ...prev, countryCode: code }))
      setCountryDetecting(false)
    })
  }, [])

  // Update phone prefix when country changes
  useEffect(() => {
    const prefix = PHONE_PREFIXES[customer.countryCode] || ""
    if (prefix && !customer.phone.startsWith("+")) {
      setCustomer((prev) => ({ ...prev, phone: prefix }))
    }
  }, [customer.countryCode])

  const subtotalCents = useMemo(() => {
    if (typeof cart.subtotalCents === "number") return cart.subtotalCents
    return cart.items.reduce((sum, item) => sum + (item.linePriceCents ?? item.priceCents ?? 0), 0)
  }, [cart])

  const discountCents = useMemo(() => {
    const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
    const raw = subtotalCents - shopifyTotal
    return raw > 0 ? raw : 0
  }, [subtotalCents, cart.totalCents])

  const shippingToApply = calculatedShippingCents
  const totalToPayCents = subtotalCents - discountCents + shippingToApply

  // FB Pixel
  useEffect(() => {
    if (fbPixelSent) return
    const sendFBPixel = () => {
      if (typeof window !== "undefined" && (window as any).fbq && cart.items.length > 0) {
        const attrs = cart.rawCart?.attributes || {}
        const contentIds = cart.items.map((item) => String(item.id)).filter(Boolean)
        ;(window as any).fbq("track", "InitiateCheckout", {
          value: totalToPayCents / 100, currency, content_ids: contentIds,
          content_type: "product", num_items: cart.items.reduce((s, i) => s + i.quantity, 0),
        }, { eventID: cart.paymentIntentId || sessionId })
        setFbPixelSent(true)
      }
    }
    if ((window as any).fbq) sendFBPixel()
    else {
      const check = setInterval(() => { if ((window as any).fbq) { clearInterval(check); sendFBPixel() } }, 100)
      setTimeout(() => clearInterval(check), 5000)
    }
  }, [fbPixelSent, cart, totalToPayCents, currency, sessionId])

  // Google Maps Autocomplete
  useEffect(() => {
    let mounted = true
    const win = window as any

    const initAutocomplete = () => {
      if (!mounted || !addressInputRef.current) return
      if (!win.google?.maps?.places) return
      try {
        if (autocompleteRef.current) {
          win.google.maps.event.clearInstanceListeners(autocompleteRef.current)
          autocompleteRef.current = null
        }
        autocompleteRef.current = new win.google.maps.places.Autocomplete(
          addressInputRef.current,
          {
            types: ["address"],
            fields: ["address_components", "formatted_address", "geometry"],
          }
        )
        autocompleteRef.current.addListener("place_changed", () => { if (mounted) handlePlaceSelect() })
      } catch (err) { console.error("[Autocomplete]", err) }
    }

    if (!win.google?.maps?.places && !scriptLoadedRef.current) {
      scriptLoadedRef.current = true
      const script = document.createElement("script")
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      if (!apiKey) return
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=${lang}&callback=initGoogleMaps`
      script.async = true; script.defer = true
      win.initGoogleMaps = () => { if (mounted) requestAnimationFrame(initAutocomplete) }
      document.head.appendChild(script)
    } else if (win.google?.maps?.places) { initAutocomplete() }

    return () => {
      mounted = false
      if (autocompleteRef.current && win.google?.maps?.event) {
        try { win.google.maps.event.clearInstanceListeners(autocompleteRef.current) } catch {}
      }
    }
  }, [lang])

  function handlePlaceSelect() {
    const place = autocompleteRef.current?.getPlace()
    if (!place?.address_components) return
    let street = "", streetNumber = "", city = "", province = "", postalCode = "", country = ""
    place.address_components.forEach((c: any) => {
      const types = c.types
      if (types.includes("route")) street = c.long_name
      if (types.includes("street_number")) streetNumber = c.long_name
      if (types.includes("locality")) city = c.long_name
      if (types.includes("postal_town") && !city) city = c.long_name
      if (types.includes("administrative_area_level_3") && !city) city = c.long_name
      if (types.includes("administrative_area_level_2")) province = c.short_name
      if (types.includes("administrative_area_level_1") && !province) province = c.short_name
      if (types.includes("postal_code")) postalCode = c.long_name
      if (types.includes("country")) country = c.short_name
    })
    const fullAddress = streetNumber ? `${street} ${streetNumber}` : street
    setCustomer((prev) => ({
      ...prev,
      address1: fullAddress || prev.address1,
      city: city || prev.city,
      postalCode: postalCode || prev.postalCode,
      province: province || prev.province,
      countryCode: country || prev.countryCode,
    }))
  }

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setCustomer((prev) => ({ ...prev, [name]: value }))
  }

  function handleBillingChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setBillingAddress((prev) => ({ ...prev, [name]: value }))
  }

  function isFormValid() {
    const ok =
      customer.fullName.trim().length > 2 &&
      customer.email.trim().includes("@") &&
      customer.email.trim().length > 5 &&
      customer.phone.trim().length > 8 &&
      customer.address1.trim().length > 3 &&
      customer.city.trim().length > 1 &&
      customer.postalCode.trim().length > 2 &&
      customer.province.trim().length > 1 &&
      customer.countryCode.trim().length >= 2
    if (!useDifferentBilling) return ok
    return ok &&
      billingAddress.fullName.trim().length > 2 &&
      billingAddress.address1.trim().length > 3 &&
      billingAddress.city.trim().length > 1 &&
      billingAddress.postalCode.trim().length > 2 &&
      billingAddress.province.trim().length > 1 &&
      billingAddress.countryCode.trim().length >= 2
  }

  // Payment Intent calculation
  useEffect(() => {
    async function calculateShipping() {
      const formHash = JSON.stringify({
        fullName: customer.fullName.trim(), email: customer.email.trim(),
        phone: customer.phone.trim(), address1: customer.address1.trim(),
        city: customer.city.trim(), postalCode: customer.postalCode.trim(),
        province: customer.province.trim(), countryCode: customer.countryCode,
        subtotal: subtotalCents, discount: discountCents,
      })

      if (!isFormValid()) {
        setCalculatedShippingCents(0)
        setClientSecret(null); setShippingError(null); setLastCalculatedHash("")
        return
      }
      if (formHash === lastCalculatedHash && clientSecret) return
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

      debounceTimerRef.current = setTimeout(async () => {
        setIsCalculatingShipping(true); setError(null); setShippingError(null)
        try {
          const flatShippingCents = 0 // spedizione gratuita
          setCalculatedShippingCents(flatShippingCents)
          const shopifyTotal = typeof cart.totalCents === "number" ? cart.totalCents : subtotalCents
          const currentDiscount = subtotalCents - shopifyTotal
          const finalDiscount = currentDiscount > 0 ? currentDiscount : 0
          const newTotal = subtotalCents - finalDiscount + flatShippingCents

          const piRes = await fetch("/api/payment-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId, amountCents: newTotal,
              customer: {
                fullName: customer.fullName, email: customer.email,
                phone: customer.phone, address1: customer.address1,
                address2: customer.address2, city: customer.city,
                postalCode: customer.postalCode, province: customer.province,
                countryCode: customer.countryCode || "IT",
              },
            }),
          })
          const piData = await piRes.json()
          if (!piRes.ok || !piData.clientSecret) throw new Error(piData.error || "Errore pagamento")
          setClientSecret(piData.clientSecret); setLastCalculatedHash(formHash); setIsCalculatingShipping(false)
        } catch (err: any) {
          setShippingError(err.message || t.calcShipping); setIsCalculatingShipping(false)
        }
      }, 1000)
    }
    calculateShipping()
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [
    customer.fullName, customer.email, customer.phone, customer.address1,
    customer.address2, customer.city, customer.postalCode, customer.province,
    customer.countryCode, billingAddress.fullName, billingAddress.address1,
    useDifferentBilling, sessionId, subtotalCents, cart.totalCents,
    clientSecret, lastCalculatedHash, discountCents,
  ])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null); setSuccess(false)
    if (!isFormValid()) { setError(t.fillRequired); return }
    if (!stripe || !elements) { setError(t.stripeNotReady); return }
    if (!clientSecret) { setError(t.piNotCreated); return }
    try {
      setLoading(true)
      const { error: submitError } = await elements.submit()
      if (submitError) { setError(submitError.message || t.errorPayment); setLoading(false); return }
      const finalBilling = useDifferentBilling ? billingAddress : customer
      const { error: stripeError } = await stripe.confirmPayment({
        elements, clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/thank-you?sessionId=${sessionId}`,
          payment_method_data: {
            billing_details: {
              name: finalBilling.fullName || customer.fullName,
              email: customer.email,
              phone: finalBilling.phone || customer.phone,
              address: {
                line1: finalBilling.address1,
                line2: finalBilling.address2 || undefined,
                city: finalBilling.city,
                postal_code: finalBilling.postalCode,
                state: finalBilling.province,
                country: finalBilling.countryCode || "IT",
              },
            },
            metadata: {
              session_id: sessionId,
              customer_fullName: customer.fullName,
              customer_email: customer.email,
              shipping_country: customer.countryCode,
              checkout_type: "riphone_custom",
            },
          },
        },
        redirect: "if_required",
      })
      if (stripeError) { setError(stripeError.message || t.errorPayment); setLoading(false); return }
      setSuccess(true); setLoading(false)
      setTimeout(() => { window.location.href = `/thank-you?sessionId=${sessionId}` }, 2000)
    } catch (err: any) {
      setError(err.message || t.errorPayment); setLoading(false)
    }
  }

  const cartUrl = cart.shopDomain ? `https://${cart.shopDomain}/cart` : "/cart"

  // Input style
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "13px 16px", fontSize: 16, color: "#1d1d1f",
    background: "#fff", border: "1.5px solid #d2d2d7", borderRadius: 10,
    transition: "all .2s", outline: "none", fontFamily: "inherit",
  }
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 13, fontWeight: 500, color: "#6e6e73", marginBottom: 6,
  }
  const sectionStyle: React.CSSProperties = {
    background: "#fff", border: "1px solid #e5e5ea", borderRadius: 16,
    padding: 24, marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,.05)",
  }
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 17, fontWeight: 600, color: "#1d1d1f", marginBottom: 20,
  }

  return (
    <>
      <Script id="facebook-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init','3891846021132542');fbq('track','PageView');
      `}</Script>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
          background: #f5f5f7;
          color: #1d1d1f;
          -webkit-font-smoothing: antialiased;
        }
        input:focus, select:focus {
          border-color: #0071e3 !important;
          box-shadow: 0 0 0 3px rgba(0,113,227,.15) !important;
        }
        input::placeholder { color: #aeaeb2; }
        .rp-btn {
          width: 100%; padding: 18px 24px; font-size: 17px; font-weight: 600;
          color: #fff; background: #0071e3; border: none; border-radius: 12px;
          cursor: pointer; transition: all .2s; letter-spacing: .01em;
          box-shadow: 0 4px 14px rgba(0,113,227,.35);
        }
        .rp-btn:hover:not(:disabled) {
          background: #0077ed;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(0,113,227,.45);
        }
        .rp-btn:disabled { background: #c7c7cc; cursor: not-allowed; box-shadow: none; }
        .main-grid {
          display: grid;
          grid-template-columns: 1fr 420px;
          gap: 40px;
          align-items: start;
        }
        .trust-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          background: #fff;
          border-radius: 16px;
          padding: 16px 20px;
          border: 1px solid #e5e5ea;
          box-shadow: 0 1px 4px rgba(0,0,0,.05);
        }
        .desktop-summary { display: block; }
        .mobile-summary-toggle { display: none; }
        @media (max-width: 1023px) {
          .main-grid { grid-template-columns: 1fr; }
          .desktop-summary { display: none !important; }
          .mobile-summary-toggle { display: block; }
        }
        @media (max-width: 768px) {
          .trust-strip { grid-template-columns: repeat(2, 1fr); padding: 12px; gap: 8px; }
          input, select { font-size: 16px !important; }
          .rp-btn { padding: 16px 20px; font-size: 16px; min-height: 52px; }
        }
        .pac-container {
          background: #fff !important; border: 1px solid #d2d2d7 !important;
          border-radius: 12px !important; box-shadow: 0 4px 16px rgba(0,0,0,.12) !important;
          font-family: inherit !important; z-index: 9999 !important;
        }
        .pac-item { padding: 12px 16px !important; border: none !important; font-size: 14px !important; }
        .pac-item:hover { background: #f5f5f7 !important; }
        .pac-icon { display: none !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .shimmer-green {
          background: linear-gradient(90deg, #166534, #16a34a, #166534);
          background-size: 200% auto;
          animation: shimmer 3s linear infinite;
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f5f5f7", overflowX: "hidden" }}>

        {/* HEADER */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          background: "rgba(255,255,255,.95)", backdropFilter: "blur(20px)",
          borderBottom: "1px solid #e5e5ea", boxShadow: "0 1px 6px rgba(0,0,0,.06)",
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <a href={cartUrl}>
              <img
                src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241"
                alt="RiPhone"
                style={{ height: 36, width: "auto" }}
              />
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                color: "#1a7f3c", background: "#f0fdf4", border: "1px solid #a7f0c0",
                borderRadius: 30, padding: "6px 14px",
              }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="#1a7f3c">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {t.securePayment}
              </div>
            </div>
          </div>
        </header>

        {/* TRUST STRIP */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
          <div className="trust-strip">
            {[
              { icon: "🔒", title: t.securePayment, sub: "100%" },
              { icon: "🚀", title: t.freeShipping, sub: t.freeShippingSubt, green: true },
              { icon: "↩", title: t.easyReturn, sub: t.easyReturnSubt },
              { icon: "💬", title: t.support, sub: t.supportSubt },
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: item.green ? "#f0fdf4" : "#f5f5f7",
                border: item.green ? "1px solid #86efac" : "1px solid #e5e5ea",
                borderRadius: 12, padding: "10px 12px",
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: item.green ? "#166534" : "#1d1d1f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                  <div style={{ fontSize: 10, color: item.green ? "#16a34a" : "#6e6e73", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* MOBILE SUMMARY TOGGLE */}
        <div className="mobile-summary-toggle" style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
          <div
            onClick={() => setOrderSummaryExpanded(!orderSummaryExpanded)}
            style={{
              background: "#fff", border: "1px solid #e5e5ea", borderRadius: 12,
              padding: 16, cursor: "pointer", display: "flex",
              justifyContent: "space-between", alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                style={{ transform: orderSummaryExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>
                <path d="M4 6L8 10L12 6" stroke="#0071e3" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#0071e3" }}>
                {orderSummaryExpanded ? t.hideOrder : t.showOrder}
              </span>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{formatMoney(totalToPayCents, currency, lang)}</span>
          </div>
          {orderSummaryExpanded && (
            <div style={{ background: "#fff", border: "1px solid #e5e5ea", borderTop: "none", borderRadius: "0 0 12px 12px", padding: 16 }}>
              <OrderSummary cart={cart} subtotalCents={subtotalCents} discountCents={discountCents} totalToPayCents={totalToPayCents} currency={currency} lang={lang} t={t} />
            </div>
          )}
        </div>

        {/* MAIN GRID */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 20px 60px" }}>
          <div className="main-grid">
            {/* LEFT: FORM */}
            <form onSubmit={handleSubmit}>

              {/* CONTACT */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>01 — {t.contactInfo}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={labelStyle}>{t.fullName} *</label>
                    <input name="fullName" value={customer.fullName} onChange={handleChange}
                      placeholder="Mario Rossi" style={inputStyle} required />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={labelStyle}>{t.email} *</label>
                      <input name="email" type="email" value={customer.email} onChange={handleChange}
                        placeholder="mario@email.com" style={inputStyle} required />
                    </div>
                    <div>
                      <label style={labelStyle}>{t.phone} *</label>
                      <input name="phone" type="tel" value={customer.phone} onChange={handleChange}
                        placeholder={PHONE_PREFIXES[customer.countryCode] || "+39"} style={inputStyle} required />
                    </div>
                  </div>
                </div>
              </div>

              {/* SHIPPING ADDRESS */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>02 — {t.shippingAddress}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={labelStyle}>{t.country} *</label>
                    <select name="countryCode" value={customer.countryCode} onChange={handleChange} style={{ ...inputStyle, cursor: "pointer" }}>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t.address1} *</label>
                    <input
                      ref={addressInputRef}
                      name="address1" value={customer.address1} onChange={handleChange}
                      placeholder="Via Roma 1" style={inputStyle} required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t.address2}</label>
                    <input name="address2" value={customer.address2} onChange={handleChange}
                      placeholder="Apt 4B" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 12 }}>
                    <div>
                      <label style={labelStyle}>{t.city} *</label>
                      <input name="city" value={customer.city} onChange={handleChange}
                        placeholder="Milano" style={inputStyle} required />
                    </div>
                    <div>
                      <label style={labelStyle}>{t.province} *</label>
                      <input name="province" value={customer.province} onChange={handleChange}
                        placeholder="MI" style={inputStyle} required />
                    </div>
                    <div>
                      <label style={labelStyle}>{t.postalCode} *</label>
                      <input name="postalCode" value={customer.postalCode} onChange={handleChange}
                        placeholder="20100" style={inputStyle} required />
                    </div>
                  </div>
                </div>
              </div>

              {/* DIFFERENT BILLING */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: "#1d1d1f", fontWeight: 500 }}>
                  <input type="checkbox" checked={useDifferentBilling} onChange={(e) => setUseDifferentBilling(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: "#0071e3" }} />
                  {t.differentBilling}
                </label>
              </div>

              {useDifferentBilling && (
                <div style={sectionStyle}>
                  <div style={sectionTitleStyle}>{t.billingAddress}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={labelStyle}>{t.fullName} *</label>
                      <input name="fullName" value={billingAddress.fullName} onChange={handleBillingChange} placeholder="Nome Cognome" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t.country} *</label>
                      <select name="countryCode" value={billingAddress.countryCode} onChange={handleBillingChange} style={{ ...inputStyle, cursor: "pointer" }}>
                        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{t.address1} *</label>
                      <input name="address1" value={billingAddress.address1} onChange={handleBillingChange} placeholder="Via Roma 1" style={inputStyle} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 12 }}>
                      <div>
                        <label style={labelStyle}>{t.city} *</label>
                        <input name="city" value={billingAddress.city} onChange={handleBillingChange} placeholder="Milano" style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>{t.province} *</label>
                        <input name="province" value={billingAddress.province} onChange={handleBillingChange} placeholder="MI" style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle}>{t.postalCode} *</label>
                        <input name="postalCode" value={billingAddress.postalCode} onChange={handleBillingChange} placeholder="20100" style={inputStyle} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PAYMENT */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>03 — {t.payment}</div>

                {isCalculatingShipping ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: "#6e6e73", fontSize: 14 }}>
                    <div style={{ width: 20, height: 20, border: "2px solid #e5e5ea", borderTopColor: "#0071e3", borderRadius: "50%", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                    {t.calcShipping}
                  </div>
                ) : clientSecret ? (
                  <PaymentElement options={{ layout: "tabs" }} />
                ) : (
                  <div style={{ padding: "20px 0", color: "#aeaeb2", fontSize: 14, textAlign: "center" }}>
                    {t.piNotCreated}
                  </div>
                )}

                {shippingError && (
                  <div style={{ marginTop: 12, padding: 12, background: "#fff2f2", border: "1px solid #ffb3b3", borderRadius: 10, color: "#d93025", fontSize: 13 }}>
                    ⚠️ {shippingError}
                  </div>
                )}

                {error && (
                  <div style={{ marginTop: 12, padding: 14, background: "#fff2f2", border: "1px solid #ffb3b3", borderRadius: 10, color: "#d93025", fontSize: 14, fontWeight: 500 }}>
                    ⚠️ {error}
                  </div>
                )}

                {success && (
                  <div style={{ marginTop: 12, padding: 14, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, color: "#166534", fontSize: 14, fontWeight: 600 }}>
                    {t.orderSuccess}
                  </div>
                )}

                <div style={{ marginTop: 20 }}>
                  <button
                    type="submit"
                    className="rp-btn"
                    disabled={loading || !clientSecret || isCalculatingShipping || success}
                  >
                    {loading ? t.processing : `🔒 ${t.payNow} — ${formatMoney(totalToPayCents, currency, lang)}`}
                  </button>
                </div>

                {/* Trust badges */}
                <div style={{ marginTop: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                  {["visa", "mastercard", "amex", "paypal"].map((brand) => (
                    <div key={brand} style={{ padding: "4px 10px", background: "#f5f5f7", border: "1px solid #e5e5ea", borderRadius: 6, fontSize: 11, fontWeight: 600, color: "#6e6e73" }}>
                      {brand.toUpperCase()}
                    </div>
                  ))}
                </div>

                {/* RiPhone trust */}
                <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
                  {[
                    { icon: "🏆", text: t.certified },
                    { icon: "🔋", text: t.warranty },
                    { icon: "✅", text: t.reconditioned },
                  ].map((item, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6e6e73" }}>
                      <span>{item.icon}</span>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

            </form>

            {/* RIGHT: DESKTOP SUMMARY */}
            <div className="desktop-summary">
              <div style={{ ...sectionStyle, position: "sticky", top: 80 }}>
                <OrderSummary cart={cart} subtotalCents={subtotalCents} discountCents={discountCents} totalToPayCents={totalToPayCents} currency={currency} lang={lang} t={t} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── ORDER SUMMARY COMPONENT ─────────────────────────────────────────────────

function OrderSummary({
  cart, subtotalCents, discountCents, totalToPayCents, currency, lang, t,
}: {
  cart: CartSessionResponse
  subtotalCents: number
  discountCents: number
  totalToPayCents: number
  currency: string
  lang: Lang
  t: Record<string, string>
}) {
  return (
    <>
      {/* Items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
        {cart.items.map((item, idx) => {
          const original = (item.priceCents || 0) * item.quantity
          const current = item.linePriceCents || 0
          const isDisc = original > current && current > 0
          const isFree = current === 0 && (item.priceCents || 0) > 0
          return (
            <div key={idx} style={{ display: "flex", gap: 14, position: "relative" }}>
              {item.image && (
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <img src={item.image} alt={item.title}
                    style={{ width: 68, height: 68, objectFit: "contain", borderRadius: 10, border: "1px solid #e5e5ea", background: "#f5f5f7" }} />
                  <span style={{
                    position: "absolute", top: -8, right: -8, background: "#1d1d1f", color: "#fff",
                    width: 22, height: 22, borderRadius: "50%", display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                  }}>{item.quantity}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#1d1d1f" }}>{item.title}</p>
                {item.variantTitle && <p style={{ fontSize: 11, color: "#6e6e73", marginTop: 3 }}>{item.variantTitle}</p>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {isFree ? (
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1a7f3c" }}>{t.free}</span>
                ) : isDisc ? (
                  <>
                    <p style={{ fontSize: 11, color: "#aeaeb2", textDecoration: "line-through" }}>{formatMoney(original, currency, lang)}</p>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#1a7f3c" }}>{formatMoney(current, currency, lang)}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{formatMoney(current, currency, lang)}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Totals */}
      <div style={{ borderTop: "1px solid #e5e5ea", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#6e6e73" }}>{t.subtotal}</span>
          <span style={{ fontWeight: 600 }}>{formatMoney(subtotalCents, currency, lang)}</span>
        </div>
        {discountCents > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#1a7f3c", fontWeight: 600 }}>✨ {t.discount}</span>
            <span style={{ color: "#1a7f3c", fontWeight: 700 }}>-{formatMoney(discountCents, currency, lang)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#6e6e73" }}>🚀 {t.shipping}</span>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 11, color: "#aeaeb2", textDecoration: "line-through", display: "block" }}>€5,90</span>
            <span style={{ fontWeight: 800, color: "#1a7f3c", fontSize: 13 }} className="shimmer-green">{t.free}</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e5e5ea", paddingTop: 14, fontSize: 17, fontWeight: 800 }}>
          <span>{t.total}</span>
          <span style={{ color: "#0071e3" }}>{formatMoney(totalToPayCents, currency, lang)}</span>
        </div>
      </div>

      {/* Social proof */}
      <div style={{ marginTop: 20, padding: "14px 16px", background: "#f5f5f7", border: "1px solid #e5e5ea", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ color: "#f5a623", fontSize: 14 }}>★★★★★</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>4,9/5</span>
          <span style={{ fontSize: 11, color: "#6e6e73" }}>(2.847 {t.reviews})</span>
        </div>
        <p style={{ fontSize: 11, color: "#6e6e73" }}>
          ✓ {t.lastPurchase} <strong>3 {t.minutesAgo}</strong>
        </p>
      </div>

      {/* RiPhone badges */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { icon: "✅", text: t.reconditioned },
          { icon: "🏆", text: t.certified },
          { icon: "🔋", text: t.warranty },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#1d1d1f" }}>
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span style={{ fontWeight: 500 }}>{item.text}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── PAGE WRAPPER ─────────────────────────────────────────────────────────────

function CheckoutPageContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId") || ""
  const [cart, setCart] = useState<CartSessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [lang, setLang] = useState<Lang>("it")
  const t = TRANSLATIONS[lang]

  useEffect(() => {
    detectCountryFromIP().then((code) => {
      setLang(COUNTRY_TO_LANG[code] || "it")
    })
  }, [])

  useEffect(() => {
    async function load() {
      if (!sessionId) { setError("sessionId mancante"); setLoading(false); return }
      try {
        const res = await fetch(`/api/cart-session?sessionId=${encodeURIComponent(sessionId)}`)
        const data: CartSessionResponse & { error?: string } = await res.json()
        if (!res.ok || data.error) { setError(data.error || "Errore caricamento"); setLoading(false); return }
        setCart(data)
        const pkRes = await fetch("/api/stripe-status")
        if (!pkRes.ok) throw new Error("stripe-status non disponibile")
        const pkData = await pkRes.json()
        if (pkData.publishableKey) setStripePromise(loadStripe(pkData.publishableKey))
        else throw new Error("Chiave pubblica mancante")
        setLoading(false)
      } catch (err: any) {
        setError(err?.message || "Errore imprevisto")
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  if (loading || !stripePromise) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, background: "#f5f5f7" }}>
        <img src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241" alt="RiPhone" style={{ height: 40, marginBottom: 8 }} />
        <div style={{ width: 40, height: 40, border: "3px solid #e5e5ea", borderTopColor: "#0071e3", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <p style={{ fontSize: 14, color: "#6e6e73", fontWeight: 500 }}>{t.loading}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error || !cart) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f5f5f7" }}>
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center", background: "#fff", borderRadius: 20, padding: 40, boxShadow: "0 4px 20px rgba(0,0,0,.08)", border: "1px solid #e5e5ea" }}>
          <img src="https://cdn.shopify.com/s/files/1/1001/4248/1751/files/Progetto_senza_titolo.png?v=1773397241" alt="RiPhone" style={{ height: 36, marginBottom: 20 }} />
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: "#1d1d1f" }}>{t.loadError}</h1>
          <p style={{ fontSize: 14, color: "#6e6e73", marginBottom: 24 }}>{error}</p>
          <a href="/cart" style={{ display: "inline-block", padding: "14px 28px", background: "#0071e3", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
            {t.backToCart}
          </a>
        </div>
      </div>
    )
  }

  const options = {
    mode: "payment" as const,
    amount: 1000,
    currency: (cart.currency || "eur").toLowerCase(),
    paymentMethodTypes: ["card"],
    appearance: {
      theme: "stripe" as const,
      variables: {
        colorPrimary: "#0071e3",
        colorBackground: "#ffffff",
        colorText: "#1d1d1f",
        colorDanger: "#d93025",
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
        spacingUnit: "4px",
        borderRadius: "10px",
        fontSizeBase: "16px",
      },
    },
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutInner cart={cart} sessionId={sessionId} />
    </Elements>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f7", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e5e5ea", borderTopColor: "#0071e3", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <CheckoutPageContent />
    </Suspense>
  )
}
"use client"

import { useEffect, useState } from "react"

type StripeAccountForm = {
  label: string
  secretKey: string
  webhookSecret: string
  active: boolean
}

type AppConfigForm = {
  shopifyDomain: string
  shopifyAdminToken: string
  shopifyStorefrontToken: string
  checkoutDomain: string
  stripeAccounts: StripeAccountForm[]
}

const EMPTY_STRIPE_ACCOUNTS: StripeAccountForm[] = [
  { label: "Account 1", secretKey: "", webhookSecret: "", active: true },
  { label: "Account 2", secretKey: "", webhookSecret: "", active: false },
  { label: "Account 3", secretKey: "", webhookSecret: "", active: false },
  { label: "Account 4", secretKey: "", webhookSecret: "", active: false },
]

export default function OnboardingPage() {
  const [form, setForm] = useState<AppConfigForm>({
    shopifyDomain: "",
    shopifyAdminToken: "",
    shopifyStorefrontToken: "",
    checkoutDomain: "",
    stripeAccounts: EMPTY_STRIPE_ACCOUNTS,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(
    null
  )

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/api/config")
        if (!res.ok) throw new Error("Impossibile caricare la configurazione")
        const data = await res.json()

        setForm({
          shopifyDomain: data.shopifyDomain || "",
          shopifyAdminToken: data.shopifyAdminToken || "",
          shopifyStorefrontToken: data.shopifyStorefrontToken || "",
          checkoutDomain:
            data.checkoutDomain || window.location.origin || "",
          stripeAccounts:
            (data.stripeAccounts && data.stripeAccounts.length
              ? data.stripeAccounts
              : EMPTY_STRIPE_ACCOUNTS
            ).map((acc: any, idx: number) => ({
              label: acc.label || `Account ${idx + 1}`,
              secretKey: acc.secretKey || "",
              webhookSecret: acc.webhookSecret || "",
              active: typeof acc.active === "boolean" ? acc.active : idx === 0,
            })),
        })
      } catch (err) {
        console.error(err)
        setStatus({
          ok: false,
          msg: "Errore nel caricamento della configurazione",
        })
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [])

  function updateField<K extends keyof AppConfigForm>(key: K, value: AppConfigForm[K]) {
    setForm(prev => ({
      ...prev,
      [key]: value,
    }))
  }

  function updateStripeAccount(
    index: number,
    patch: Partial<StripeAccountForm>
  ) {
    setForm(prev => {
      const next = [...prev.stripeAccounts]
      next[index] = { ...next[index], ...patch }
      return { ...prev, stripeAccounts: next }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)

    try {
      const cleaned = {
        ...form,
        stripeAccounts: form.stripeAccounts.filter(
          acc =>
            acc.secretKey.trim().length > 0 || acc.webhookSecret.trim().length > 0
        ),
      }

      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Errore nel salvataggio")
      }

      setStatus({ ok: true, msg: "Configurazione salvata ✅" })
    } catch (err: any) {
      console.error(err)
      setStatus({
        ok: false,
        msg: err.message || "Errore nel salvataggio",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4 py-10">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-24 w-72 h-72 bg-cyan-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 right-0 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-5xl">
        {/* Header style Apple/Revolut */}
        <header className="mb-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 mb-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-slate-300">
                Setup rapido · Shopify → Stripe
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
              Checkout Control Center
            </h1>
            <p className="mt-2 text-sm text-slate-300 max-w-xl">
              Collega in pochi passi Shopify, il dominio del checkout e fino a{" "}
              <span className="font-medium text-slate-100">4 account Stripe</span>.
              Tutto da un’unica dashboard, stile Apple / Revolut.
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/60 border border-white/10 text-[10px]">
                ⛩
              </span>
              <span>Ambiente</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                Live ready
              </span>
            </div>
            <span className="text-[11px]">
              Ultimo aggiornamento:{" "}
              <span className="text-slate-200">in tempo reale</span>
            </span>
          </div>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid gap-6 lg:grid-cols-[2fr,1.3fr]"
        >
          {/* Colonna sinistra: Shopify + Checkout */}
          <div className="space-y-6">
            {/* Card Shopify */}
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 md:p-6 shadow-[0_18px_60px_rgba(15,23,42,0.7)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-200">
                    Shopify Store
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Collega il tuo negozio e autorizza l’app a leggere carrelli e
                    creare ordini “paid / unfulfilled”.
                  </p>
                </div>
                <div className="flex gap-1">
                  <span className="h-8 w-8 rounded-2xl bg-black/70 border border-white/10 flex items-center justify-center text-[10px]">
                    🛒
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-200">
                    Shopify domain
                  </label>
                  <div className="flex items-center gap-2 rounded-2xl bg-black/50 border border-white/10 px-3 py-2.5 focus-within:border-cyan-400/60 focus-within:ring-1 focus-within:ring-cyan-400/40">
                    <span className="text-[11px] text-slate-400">
                      https://
                    </span>
                    <input
                      type="text"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
                      placeholder="notforresale.it o myshop.myshopify.com"
                      value={form.shopifyDomain}
                      onChange={e =>
                        updateField("shopifyDomain", e.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-200">
                    Admin API Access Token
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-2xl bg-black/50 border border-white/10 px-3 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
                    placeholder="shpat_***"
                    value={form.shopifyAdminToken}
                    onChange={e =>
                      updateField("shopifyAdminToken", e.target.value)
                    }
                  />
                  <p className="text-[11px] text-slate-500">
                    App custom Shopify · permessi: Orders (read), Checkout,
                    Products.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-200">
                    Storefront API Token (optional)
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-2xl bg-black/50 border border-white/10 px-3 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
                    placeholder="sf_***"
                    value={form.shopifyStorefrontToken}
                    onChange={e =>
                      updateField("shopifyStorefrontToken", e.target.value)
                    }
                  />
                  <p className="text-[11px] text-slate-500">
                    Usato se vuoi leggere info prodotto direttamente dalla
                    Storefront API.
                  </p>
                </div>
              </div>
            </div>

            {/* Card Checkout Domain */}
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 md:p-6 shadow-[0_18px_60px_rgba(15,23,42,0.7)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-200">
                    Checkout Domain
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Dominio pubblico dell’app (Vercel). Verrà usato per
                    reindirizzare i carrelli dal tema Shopify.
                  </p>
                </div>
                <span className="h-8 w-8 rounded-2xl bg-black/70 border border-white/10 flex items-center justify-center text-[10px]">
                  🌐
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-200">
                  URL checkout
                </label>
                <input
                  type="text"
                  className="w-full rounded-2xl bg-black/50 border border-white/10 px-3 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
                  placeholder="https://checkout-app.vercel.app"
                  value={form.checkoutDomain}
                  onChange={e =>
                    updateField("checkoutDomain", e.target.value)
                  }
                />
                <p className="text-[11px] text-slate-500">
                  Deve combaciare con <code className="text-slate-300">NEXT_PUBLIC_CHECKOUT_DOMAIN</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Colonna destra: Stripe multi-account */}
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.03] backdrop-blur-2xl p-5 md:p-6 shadow-[0_18px_60px_rgba(15,23,42,0.9)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-200">
                    Stripe Routing
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Aggiungi fino a 4 account Stripe. Il sistema può ruotare le
                    chiavi e instradare i pagamenti.
                  </p>
                </div>
                <span className="h-8 w-8 rounded-2xl bg-black/70 border border-white/10 flex items-center justify-center text-[10px]">
                  💳
                </span>
              </div>

              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {form.stripeAccounts.map((acc, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-white/10 bg-black/40 px-3.5 py-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-xl bg-slate-900/80 border border-white/10 flex items-center justify-center text-[11px]">
                          {idx + 1}
                        </div>
                        <input
                          type="text"
                          className="bg-transparent text-xs font-medium outline-none placeholder:text-slate-500"
                          value={acc.label}
                          onChange={e =>
                            updateStripeAccount(idx, {
                              label: e.target.value,
                            })
                          }
                          placeholder={`Account ${idx + 1}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateStripeAccount(idx, { active: !acc.active })
                        }
                        className={`text-[10px] px-2 py-1 rounded-full border ${
                          acc.active
                            ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-200"
                            : "bg-slate-900/70 border-white/10 text-slate-400"
                        }`}
                      >
                        {acc.active ? "Attivo" : "Disattivo"}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-300">
                        Secret key
                      </label>
                      <input
                        type="password"
                        className="w-full rounded-xl bg-slate-950/60 border border-white/10 px-2.5 py-2 text-xs outline-none placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
                        placeholder="sk_live_***"
                        value={acc.secretKey}
                        onChange={e =>
                          updateStripeAccount(idx, {
                            secretKey: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-300">
                        Webhook secret
                      </label>
                      <input
                        type="password"
                        className="w-full rounded-xl bg-slate-950/60 border border-white/10 px-2.5 py-2 text-xs outline-none placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
                        placeholder="whsec_***"
                        value={acc.webhookSecret}
                        onChange={e =>
                          updateStripeAccount(idx, {
                            webhookSecret: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer card stripe */}
              <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                <span>
                  Puoi lasciare vuoti gli account non usati. Verranno ignorati.
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/10">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Webhook centralizzato</span>
                </span>
              </div>
            </div>

            {/* Barra azioni / stato */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {status && (
                <div
                  className={`text-xs px-3 py-2 rounded-2xl border backdrop-blur-xl ${
                    status.ok
                      ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-100"
                      : "bg-rose-500/10 border-rose-500/40 text-rose-100"
                  }`}
                >
                  {status.msg}
                </div>
              )}

              <div className="flex items-center gap-2 md:justify-end">
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-200 transition"
                  onClick={() => window.location.assign("/")}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={saving || loading}
                  className="inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 bg-white/10 border border-white/20 backdrop-blur-2xl text-sm font-medium text-slate-50 hover:bg-white/20 disabled:opacity-60 disabled:cursor-not-allowed transition shadow-[0_10px_40px_rgba(15,23,42,0.8)]"
                >
                  {saving ? (
                    <>
                      <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-transparent animate-spin" />
                      Salvando…
                    </>
                  ) : (
                    <>
                      <span>Salva configurazione</span>
                      <span className="text-xs opacity-80">⌘ + S</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Overlay loading iniziale */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-xl rounded-3xl">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-white/30 border-t-transparent animate-spin" />
              <span className="text-xs text-slate-300">
                Caricamento configurazione…
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

type StripeAccountInput = {
  label: string;
  name: string;
};

const STRIPE_ACCOUNTS: StripeAccountInput[] = [
  { label: "Account 1", name: "account1" },
  { label: "Account 2", name: "account2" },
  { label: "Account 3", name: "account3" },
  { label: "Account 4", name: "account4" },
];

export default function OnboardingPage() {
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [existingConfig, setExistingConfig] = useState<any>(null);
  const [showSensitive, setShowSensitive] = useState(false);

  // ✅ AUTH CON ADMIN_SECRET_KEY
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ✅ CHECK AUTH AL MOUNT
  useEffect(() => {
    const savedAuth = localStorage.getItem('onboardingAuth');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
      loadConfig();
    } else {
      setLoadingConfig(false);
    }
  }, []);

  // ✅ HANDLER LOGIN
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    
    try {
      const res = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (res.ok) {
        setIsAuthenticated(true);
        localStorage.setItem('onboardingAuth', 'true');
        loadConfig();
      } else {
        const data = await res.json();
        setAuthError(data.error || 'Password non corretta');
      }
    } catch (err) {
      setAuthError('Errore di connessione');
    } finally {
      setAuthLoading(false);
    }
  };

  // ✅ LOGOUT
  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('onboardingAuth');
    setPassword('');
  };

  // RESTO INVARIATO
  async function loadConfig() {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setExistingConfig(data);
        console.log("[onboarding] ✅ Config caricata:", data);
        console.log("[onboarding] 📋 Stripe accounts:", data?.stripeAccounts);
      }
    } catch (err) {
      console.error("[onboarding] ❌ Errore caricamento config:", err);
    } finally {
      setLoadingConfig(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);

    const formData = new FormData(e.currentTarget);

    const payload = {
      shopify: {
        shopDomain: (formData.get("shopifyDomain") as string) || existingConfig?.shopify?.shopDomain || "",
        adminToken: (formData.get("shopifyAdminToken") as string) || existingConfig?.shopify?.adminToken || "",
        storefrontToken:
          (formData.get("shopifyStorefrontToken") as string) || existingConfig?.shopify?.storefrontToken || "",
        apiVersion: "2024-10",
      },

      stripeAccounts: STRIPE_ACCOUNTS.map((acc, index) => {
        const existingAccount = existingConfig?.stripeAccounts?.[index] || {};
        
        return {
          label:
            ((formData.get(`${acc.name}-label`) as string) ||
              acc.label) ?? `Account ${index + 1}`,
          secretKey: ((formData.get(`${acc.name}-secret`) as string) || existingAccount.secretKey || "").trim(),
          publishableKey: ((formData.get(`${acc.name}-publishable`) as string) || existingAccount.publishableKey || "").trim(),
          webhookSecret:
            ((formData.get(`${acc.name}-webhook`) as string) || existingAccount.webhookSecret || "").trim(),
          active: formData.get(`${acc.name}-active`) === "on",
          order: index,
          merchantSite:
            ((formData.get(`${acc.name}-merchantSite`) as string) || existingAccount.merchantSite || "").trim(),
          lastUsedAt: existingAccount?.lastUsedAt || 0,
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `productTitle${i + 1}`,
              ((formData.get(`${acc.name}-productTitle${i + 1}`) as string) || existingAccount[`productTitle${i + 1}`] || "").trim(),
            ])
          ),
        };
      }),

      defaultCurrency: (
        (formData.get("defaultCurrency") as string) ||
        existingConfig?.defaultCurrency ||
        "eur"
      ).toLowerCase(),
      checkoutDomain:
        (typeof window !== "undefined" ? window.location.origin : "") || "",
    };

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Errore salvataggio configurazione");
      }

      setSaved(true);
      
      const reloadRes = await fetch("/api/config");
      if (reloadRes.ok) {
        const reloadData = await reloadRes.json();
        setExistingConfig(reloadData);
      }
    } catch (err: any) {
      setError(err.message ?? "Errore imprevisto");
    } finally {
      setLoading(false);
    }
  }

  // ✅ SCHERMATA LOGIN
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <div className="glass-card p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <Lock className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-50">🔒 Onboarding Admin</h1>
            <p className="text-sm text-slate-400 mt-2">Inserisci ADMIN_SECRET_KEY per accedere</p>
          </div>
          
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="glass-label">Password Admin</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="glass-input"
                placeholder="Inserisci ADMIN_SECRET_KEY"
                required
                disabled={authLoading}
              />
            </div>

            {authError && (
              <div className="bg-red-950/60 border border-red-500/40 text-red-100 px-4 py-3 rounded-lg text-sm">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="glass-button-primary w-full"
              disabled={authLoading}
            >
              {authLoading ? 'Verifica in corso...' : 'Accedi'}
            </button>
          </form>
          
          <p className="text-xs text-slate-500 text-center mt-4">
            Usa la password configurata su Vercel come variabile ADMIN_SECRET_KEY
          </p>
        </div>
      </div>
    );
  }

  // ✅ LOADING CONFIG
  if (loadingConfig) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-slate-400">Caricamento configurazione...</p>
        </div>
      </main>
    );
  }

  // ✅ DASHBOARD PRINCIPALE (TUTTO INVARIATO)
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-6xl w-full space-y-8">
        {/* ✅ Header con logout */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs text-emerald-300">
            <Lock className="w-3 h-3" />
            Admin autenticato
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs text-slate-300 backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {existingConfig ? "Modifica configurazione" : "Setup iniziale"} • Checkout Hub
            </div>
            <h1 className="mt-4 text-3xl md:text-4xl font-semibold tracking-tight text-slate-50">
              Collega Shopify, Stripe e Firebase
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-xl">
              {existingConfig 
                ? "✅ Configurazione caricata! Modifica solo i campi che vuoi aggiornare."
                : "Configura una sola volta, poi il tuo checkout custom gestirà in automatico carrelli, pagamenti multi-account Stripe e sincronizzazione ordini."
              }
            </p>
          </div>

          <div className="glass-card px-4 py-3 flex flex-col gap-1 md:w-72">
            <p className="text-xs font-medium text-slate-300">
              Stato onboarding
            </p>
            <p className="text-sm text-slate-400">
              {existingConfig 
                ? "✓ Config esistente caricata. I campi vuoti manterranno i valori attuali."
                : "Completa i campi essenziali e salva la configurazione. I dati vengono memorizzati in Firebase e riutilizzati dal backend."
              }
            </p>
          </div>
        </header>

        {/* Toggle visibilità */}
        {existingConfig && (
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setShowSensitive(!showSensitive)}
              className="glass-button inline-flex items-center gap-2 px-4 py-2"
            >
              {showSensitive ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  Nascondi dati sensibili
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Mostra dati sensibili in chiaro
                </>
              )}
            </button>
            
            <button
              type="button"
              onClick={loadConfig}
              className="glass-button inline-flex items-center gap-2 px-4 py-2 text-xs"
            >
              🔄 Ricarica pagina
            </button>
          </div>
        )}

        {/* Layout principale */}
        <form
          key={existingConfig ? JSON.stringify(existingConfig) : 'new'}
          onSubmit={handleSubmit}
          className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start"
        >
          {/* Colonna sinistra: Shopify + Stripe */}
          <div className="space-y-6">
            {/* Shopify card */}
            <section className="glass-card p-6 md:p-7 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="glass-label">Sorgente carrelli</p>
                  <h2 className="text-lg font-semibold text-slate-50 flex items-center gap-2">
                    Shopify
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                      Live ready
                    </span>
                  </h2>
                </div>
                <div className="text-right text-[11px] text-slate-400">
                  <p>Usa app privata + Storefront API</p>
                  <p>Scoped solo a ordini & prodotti</p>
                </div>
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="glass-label">Shopify Store Domain</label>
                  <input
                    name="shopifyDomain"
                    className="glass-input"
                    placeholder="es. imjsqk-my.myshopify.com"
                    defaultValue={existingConfig?.shopify?.shopDomain || ""}
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">Admin API Token</label>
                  <input
                    name="shopifyAdminToken"
                    type={showSensitive ? "text" : "password"}
                    className="glass-input font-mono text-xs"
                    placeholder="shpat_********"
                    defaultValue={existingConfig?.shopify?.adminToken || ""}
                    required
                  />
                </div>

                <div>
                  <label className="glass-label">Storefront API Token</label>
                  <input
                    name="shopifyStorefrontToken"
                    type={showSensitive ? "text" : "password"}
                    className="glass-input font-mono text-xs"
                    placeholder="Storefront token"
                    defaultValue={existingConfig?.shopify?.storefrontToken || ""}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="glass-label">Valuta di default</label>
                    <input
                      name="defaultCurrency"
                      className="glass-input"
                      defaultValue={existingConfig?.defaultCurrency || "EUR"}
                      placeholder="EUR"
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-end">
                    Usata se il carrello non espone una currency esplicita.
                  </div>
                </div>
              </div>
            </section>

            {/* Stripe accounts card */}
            <section className="glass-card p-6 md:p-7 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="glass-label">Gateway di pagamento</p>
                  <h2 className="text-lg font-semibold text-slate-50 flex items-center gap-2">
                    Stripe multi-account
                  </h2>
                </div>
                <div className="text-right text-[11px] text-slate-400">
                  <p>Fino a 4 account Stripe</p>
                  <p>Rotazione automatica ogni 6 ore</p>
                </div>
              </div>

              <div className="grid gap-4">
                {STRIPE_ACCOUNTS.map((acc, index) => {
                  const existingAccount = existingConfig?.stripeAccounts?.[index] || {};
                  
                  return (
                    <div
                      key={`${acc.name}-${index}`}
                      className="rounded-2xl border border-white/10 bg-white/3 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-200">
                            {existingAccount?.label || acc.label}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {existingAccount?.secretKey ? `✓ Configurato (${existingAccount.secretKey.substring(0, 7)}...)` : "Opzionale. Puoi anche usarne solo uno."}
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 text-[11px] text-slate-300">
                          <input
                            type="checkbox"
                            name={`${acc.name}-active`}
                            defaultChecked={existingAccount?.active ?? (index === 0)}
                            className="h-3.5 w-3.5 rounded border-white/30 bg-slate-900/60"
                          />
                          Attivo
                        </label>
                      </div>

                      <div className="grid gap-3">
                        <div>
                          <label className="glass-label">Label interna</label>
                          <input
                            name={`${acc.name}-label`}
                            className="glass-input"
                            placeholder={`es. Stripe NFR ${index + 1}`}
                            defaultValue={existingAccount?.label || ""}
                          />
                        </div>

                        <div>
                          <label className="glass-label">Secret Key</label>
                          <input
                            name={`${acc.name}-secret`}
                            type={showSensitive ? "text" : "password"}
                            className="glass-input font-mono text-xs"
                            placeholder="sk_live_*** o sk_test_***"
                            defaultValue={existingAccount?.secretKey || ""}
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            📍 Stripe Dashboard → Developers → API keys → Secret key
                          </p>
                        </div>

                        <div>
                          <label className="glass-label">Publishable Key</label>
                          <input
                            name={`${acc.name}-publishable`}
                            type={showSensitive ? "text" : "password"}
                            className="glass-input font-mono text-xs"
                            placeholder="pk_live_*** o pk_test_***"
                            defaultValue={existingAccount?.publishableKey || ""}
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            📍 Stripe Dashboard → Developers → API keys → Publishable key
                          </p>
                        </div>

                        <div>
                          <label className="glass-label">
                            Webhook Secret{" "}
                            <span className="text-[10px] font-normal text-amber-400">
                              (Richiesto per ordini automatici)
                            </span>
                          </label>
                          <input
                            name={`${acc.name}-webhook`}
                            type={showSensitive ? "text" : "password"}
                            className="glass-input font-mono text-xs"
                            placeholder="whsec_***"
                            defaultValue={existingAccount?.webhookSecret || ""}
                          />
                          <div className="mt-2 space-y-1 text-[10px] text-slate-500">
                            <p className="font-medium text-slate-400">📍 Come ottenerlo:</p>
                            <ol className="list-decimal list-inside space-y-0.5 pl-2">
                              <li>Stripe Dashboard → Developers → Webhooks</li>
                              <li>Click &quot;Add endpoint&quot;</li>
                              <li>
                                URL:{" "}
                                <code className="text-emerald-400">
                                  {typeof window !== "undefined" ? window.location.origin : "https://tuo-dominio"}/api/webhooks/stripe
                                </code>
                              </li>
                              <li>
                                Eventi: seleziona{" "}
                                <code className="text-emerald-400">
                                  payment_intent.succeeded
                                </code>
                              </li>
                              <li>Copia il &quot;Signing secret&quot; (inizia con whsec_)</li>
                            </ol>
                          </div>
                        </div>

                        <div>
                          <label className="glass-label">
                            Merchant site (per metadata / descriptor)
                          </label>
                          <input
                            name={`${acc.name}-merchantSite`}
                            className="glass-input"
                            placeholder="es. https://notforresale.it"
                            defaultValue={existingAccount?.merchantSite || ""}
                          />
                        </div>

                        {/* Product titles dinamici */}
                        <div>
                          <label className="glass-label">
                            Product titles dinamici (max 10)
                            <span className="text-xs text-slate-400 ml-2">
                              (Usato random su ogni transazione)
                            </span>
                          </label>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {Array.from({ length: 10 }).map((_, i) => {
                              const value = existingAccount?.[`productTitle${i + 1}`] || "";
                              
                              return (
                                <input
                                  key={`${acc.name}-pt${i + 1}`}
                                  name={`${acc.name}-productTitle${i + 1}`}
                                  className="glass-input text-xs"
                                  placeholder={`Product title #${i + 1}`}
                                  defaultValue={value}
                                />
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">
                            💡 Inserisci nomi prodotto diversi. Uno random verrà usato in ogni pagamento Stripe.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Colonna destra: Firebase + azioni */}
          <aside className="space-y-4">
            {/* Firebase info */}
            <section className="glass-card p-5 md:p-6 space-y-3">
              <p className="glass-label">Storage configurazione</p>
              <h2 className="text-base font-semibold text-slate-50 flex items-center gap-2">
                Firebase Firestore
              </h2>
              <p className="text-sm text-slate-400">
                I dati inseriti qui vengono salvati su Firestore (collezione
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/40 border border-white/5 ml-1">
                  config/global
                </span>
                ) e letti dalle API:
              </p>
              <ul className="text-[11px] text-slate-400 space-y-1.5">
                <li>
                  • <code className="font-mono">/api/cart-session</code>
                </li>
                <li>
                  • <code className="font-mono">/api/payment-intent</code>
                </li>
                <li>
                  • <code className="font-mono">/api/webhooks/stripe</code>
                </li>
                <li>
                  • <code className="font-mono">/api/discount/apply</code>
                </li>
              </ul>
            </section>

            {/* Guida Webhook */}
            <section className="glass-card p-5 md:p-6 space-y-3 bg-amber-950/20 border-amber-500/30">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <h3 className="text-sm font-semibold text-amber-300">
                  Webhook Setup Importante
                </h3>
              </div>
              <p className="text-[11px] text-slate-300">
                Il webhook secret è necessario per creare automaticamente ordini su Shopify dopo il pagamento.
              </p>
              <div className="text-[11px] text-slate-400 space-y-2">
                <p className="font-medium text-slate-300">Endpoint webhook:</p>
                <code className="block bg-black/40 border border-white/10 rounded px-2 py-1.5 text-emerald-400 break-all">
                  {typeof window !== "undefined" ? window.location.origin : "https://tuo-dominio.vercel.app"}/api/webhooks/stripe
                </code>
                <p className="mt-2">
                  ⚠️ Configura questo endpoint su <strong>ogni</strong> account Stripe attivo.
                </p>
              </div>
            </section>

            {/* Stato + pulsanti */}
            <section className="glass-card p-5 md:p-6 space-y-4">
              {error && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-[11px] text-rose-100">
                  {error}
                </div>
              )}
              {saved && !error && (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/60 px-3 py-2 text-[11px] text-emerald-100">
                  ✓ Configurazione salvata correttamente.
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="submit"
                  className="glass-button-primary w-full"
                  disabled={loading}
                >
                  {loading ? "Salvataggio in corso…" : existingConfig ? "Aggiorna configurazione" : "Salva configurazione"}
                </button>
                <button
                  type="button"
                  className="glass-button w-full text-xs"
                  onClick={() => window.open("/checkout", "_blank")}
                >
                  Apri anteprima checkout
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                Puoi modificare questi valori in qualsiasi momento. Le nuove
                config verranno usate dalle prossime sessioni di checkout.
              </p>
            </section>
          </aside>
        </form>
      </div>
    </main>
  );
}

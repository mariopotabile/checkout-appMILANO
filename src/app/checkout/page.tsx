"use client";

import { useEffect, useState } from "react";
import Summary from "@/components/Summary";

type CheckoutItem = {
  id: string | number;
  title: string;
  quantity: number;
  price: number; // in centesimi
  line_price?: number; // in centesimi
  image?: string;
  variant_title?: string;
};

type CartSessionResponse = {
  sessionId: string;
  items: CheckoutItem[];
  totals: {
    subtotal: number;
    currency: string;
  };
};

export default function CheckoutPage() {
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [currency, setCurrency] = useState("EUR");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // 1) Leggi sessionId dalla query string (solo lato client)
        const params = new URLSearchParams(window.location.search);
        const id = params.get("sessionId");

        if (!id) {
          setError("Nessun carrello trovato.");
          setLoading(false);
          return;
        }

        setSessionId(id);

        // 2) Recupera il carrello salvato (Firebase) dal backend
        const url = `/api/cart-session?sessionId=${encodeURIComponent(id)}`;
        const res = await fetch(url);
        const raw = await res.text();

        let data: CartSessionResponse | any = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (e) {
          console.error("[checkout] errore parse JSON:", e, raw);
          throw new Error("Risposta non valida dal server.");
        }

        if (!res.ok) {
          console.error("[checkout] res not ok:", res.status, data);
          throw new Error(data.error || "Errore nel recupero del carrello.");
        }

        const cartItems = data.items || [];
        const totals = data.totals || {};
        const sub = typeof totals.subtotal === "number" ? totals.subtotal : 0;
        const cur = totals.currency || "EUR";

        setItems(cartItems);
        setSubtotal(sub);
        setCurrency(cur);
      } catch (err: any) {
        console.error("[checkout] errore load():", err);
        setError(
          err?.message || "Errore imprevisto nel caricamento del carrello."
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const displayTotal = (subtotal || 0) / 100;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      {/* Barra superiore stile app / Revolut */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-lg shadow-sky-500/40" />
            <div className="flex flex-col leading-tight">
              <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Secure Checkout
              </span>
              <span className="text-sm font-medium text-slate-100">
                Checkout App
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            <span className="h-1.5 w-6 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
            <span className="text-[11px] text-emerald-300/90">
              Connessione sicura
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Testo introduttivo */}
        <div className="mb-6 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-slate-50">
              Completa il tuo ordine
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Rivedi il riepilogo e paga in modo sicuro con carta tramite Stripe.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800/80">
              💳
            </span>
            Pagamenti crittografati e conformi PCI-DSS
          </div>
        </div>

        {/* Layout principale: carrello + riepilogo */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] items-start">
          {/* Colonna sinistra: articoli */}
          <section className="space-y-4">
            <div className="rounded-3xl border border-white/5 bg-slate-950/60 backdrop-blur-xl p-5 lg:p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="h-8 w-8 rounded-full border-2 border-slate-600 border-t-slate-100 animate-spin" />
                  <p className="text-sm text-slate-400">
                    Caricamento del carrello in corso...
                  </p>
                </div>
              )}

              {!loading && error && (
                <div className="py-10 text-center">
                  <p className="text-sm text-red-400">
                    {error || "Errore durante il caricamento del carrello."}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Torna al sito e riprova ad aprire il checkout.
                  </p>
                </div>
              )}

              {!loading && !error && items.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-sm text-slate-300">
                    Nessun articolo nel carrello.
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Torna al negozio per aggiungere prodotti e poi riapri il
                    checkout.
                  </p>
                </div>
              )}

              {!loading && !error && items.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-base font-medium text-slate-100">
                      Articoli nel carrello
                    </h2>
                    <span className="text-xs text-slate-400">
                      {items.length}{" "}
                      {items.length === 1 ? "articolo" : "articoli"}
                    </span>
                  </div>

                  <div className="divide-y divide-white/5 border-y border-white/5">
                    {items.map((item) => {
                      const unitPrice = (item.price || 0) / 100;

                      const lineCents =
                        typeof item.line_price === "number"
                          ? item.line_price
                          : (item.price || 0) * (item.quantity || 0);

                      const linePrice = lineCents / 100;

                      return (
                        <div
                          key={item.id}
                          className="flex gap-3 py-4 first:pt-0 last:pb-0"
                        >
                          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-slate-900 border border-white/5">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-[10px] text-slate-500">
                                Nessuna immagine
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-100 truncate">
                                  {item.title}
                                </p>
                                {item.variant_title && (
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    {item.variant_title}
                                  </p>
                                )}
                              </div>
                              <div className="text-right text-xs text-slate-400">
                                <div>
                                  {unitPrice.toFixed(2)} {currency}
                                </div>
                                <div className="text-[11px]">
                                  x {item.quantity}
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 flex justify-between text-xs text-slate-400">
                              <span>Totale riga</span>
                              <span className="font-medium text-slate-100">
                                {linePrice.toFixed(2)} {currency}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex justify-between text-sm">
                    <span className="text-slate-300">Subtotale prodotti</span>
                    <span className="font-semibold text-slate-50">
                      {displayTotal.toFixed(2)} {currency}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Colonna destra: riepilogo / bottone pagamento */}
          <section className="lg:sticky lg:top-24">
            <Summary
              subtotal={subtotal}
              currency={currency}
              items={items}
              sessionId={sessionId || ""}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
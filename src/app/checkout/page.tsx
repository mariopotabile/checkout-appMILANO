"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import CheckoutLayout from "@/components/CheckoutLayout";
import Summary from "@/components/Summary";

type CheckoutItem = {
  id: number | string;
  product_id?: number | string;
  variant_id?: number | string;
  title: string;
  variant_title?: string;
  quantity: number;
  price: number; // centesimi
  line_price?: number;
  image?: string;
  sku?: string;
};

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [subtotal, setSubtotal] = useState(0);

  useEffect(() => {
    async function load() {
      if (!sessionId) {
        setError(
          "Sessione checkout mancante.\n(sessionId non presente nell'URL)"
        );
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const url =
          "/api/cart-session?sessionId=" + encodeURIComponent(sessionId);
        const res = await fetch(url);

        const raw = await res.text();
        console.log("[checkout] raw /api/cart-session:", raw);

        let data: any = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (e) {
            console.error("[checkout] errore parse JSON:", e);
            setError(
              "Risposta non valida dal server checkout.\n(errore parse JSON)"
            );
            setLoading(false);
            return;
          }
        }

        if (!res.ok) {
          console.error("[checkout] response not ok:", res.status, data);
          setError(data.error || "Nessun carrello trovato.");
          setLoading(false);
          return;
        }

        if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
          console.warn("[checkout] items vuoti o mancanti:", data);
          setError("Il carrello risulta vuoto o non è stato trovato.");
          setLoading(false);
          return;
        }

        setItems(data.items);
        setCurrency(data.currency || "EUR");
        setSubtotal(data.subtotal || 0);
        setLoading(false);
      } catch (err: any) {
        console.error("[checkout] errore load:", err);
        setError(err?.message || "Errore nel caricamento del checkout.");
        setLoading(false);
      }
    }

    load();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-slate-100 text-sm">Caricamento checkout...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md w-full bg-slate-900/70 rounded-3xl border border-white/10 p-6 text-center text-slate-100">
          <h1 className="text-xl font-semibold mb-3">Checkout non disponibile</h1>
          <p className="text-sm mb-2 whitespace-pre-line">{error}</p>
          {sessionId && (
            <p className="text-xs text-slate-500 mt-2 break-all">
              sessionId: <code>{sessionId}</code>
            </p>
          )}
          <a
            href="/"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-white text-slate-900 px-4 py-2 text-sm font-medium"
          >
            Torna al sito
          </a>
        </div>
      </div>
    );
  }

  return (
    <CheckoutLayout>
      <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] items-start">
        {/* Lista prodotti */}
        <div className="space-y-4">
          <h1 className="text-xl font-semibold text-slate-50">
            Riepilogo ordine
          </h1>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={`${item.id}-${idx}`}
                className="flex gap-3 rounded-2xl bg-slate-900/60 border border-white/5 p-3"
              >
                {item.image && (
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-800/80">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-50">
                      {item.title}
                    </div>
                    <div className="text-sm text-slate-100">
                      {((item.price || 0) / 100).toFixed(2)} {currency}
                    </div>
                  </div>
                  {item.variant_title && (
                    <div className="text-xs text-slate-400">
                      {item.variant_title}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                    <span>Q.tà: {item.quantity}</span>
                    <span>
                      Totale riga:{" "}
                      {(
                        (item.line_price ?? item.price * item.quantity || 0) /
                        100
                      ).toFixed(2)}{" "}
                      {currency}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Riepilogo pagamento */}
        <Summary
          subtotal={subtotal}
          currency={currency}
          items={items}
          sessionId={sessionId || ""}
        />
      </div>
    </CheckoutLayout>
  );
}
"use client";

import { useEffect, useMemo, useState } from "react";
import MoonScene from "./components/MoonScene";

type Holder = {
  address: string;
  balance: number;
};

const TOKEN_MINT = "461C1ngHZtzTvMWT8gL7C2JLaYg2VQvaYj8aDFqhEni1";

function abbreviateMint(address: string) {
  if (address.length < 10) return address;

  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

export default function Home() {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHolders() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/holders?mint=${encodeURIComponent(TOKEN_MINT)}`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          const body = await response.json().catch(() => null);

          throw new Error(
            body?.error || `Unable to load holders (${response.status})`
          );
        }

        const data = await response.json();

        if (!cancelled) {
          setHolders(data.holders ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load holders."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHolders();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalVisibleTokens = useMemo(() => {
    return holders.reduce((total, holder) => total + holder.balance, 0);
  }, [holders]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white">
      <div className="absolute inset-0">
        <MoonScene holders={holders} />
      </div>

      {/* Top-left */}
      <div className="pointer-events-none absolute left-5 top-5 z-10 sm:left-8 sm:top-8">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-white" />

          <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/50">
            Holder Moon
          </span>
        </div>

        <h1 className="mt-3 text-xl font-medium tracking-tight sm:text-2xl">
          Token holders
        </h1>

        <div className="mt-2 font-mono text-xs text-white/40">
          {abbreviateMint(TOKEN_MINT)}
        </div>
      </div>

      {/* Top-right holder count */}
      {!loading && !error && (
        <div className="pointer-events-none absolute right-5 top-5 z-10 text-right sm:right-8 sm:top-8">
          <div className="font-mono text-xl font-medium tabular-nums">
            {holders.length.toLocaleString()}
          </div>

          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/35">
            holders above 1M
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-xl">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />

            <span className="text-xs text-white/50">
              Mapping holders...
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute bottom-8 left-1/2 z-10 w-[calc(100%-40px)] max-w-md -translate-x-1/2 rounded-2xl border border-white/10 bg-black/70 p-4 text-center backdrop-blur-xl">
          <p className="text-sm text-white/70">{error}</p>
        </div>
      )}

      {/* Visible token amount */}
      {!loading && !error && holders.length > 0 && (
        <div className="pointer-events-none absolute bottom-5 left-5 z-10 sm:bottom-8 sm:left-8">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">
            Visible holdings
          </div>

          <div className="mt-1 font-mono text-xs text-white/60">
            {Math.round(totalVisibleTokens).toLocaleString()} tokens
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="pointer-events-none absolute bottom-5 right-5 z-10 text-right sm:bottom-8 sm:right-8">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/25">
          Drag to rotate
        </p>
      </div>
    </main>
  );
}
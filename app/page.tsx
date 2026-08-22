"use client";

import { useEffect, useMemo, useState } from "react";
import MoonScene from "./components/MoonScene";

type Holder = {
  address: string;
  balance: number;
};

type HoldersResponse = {
  mint: string;
  minimumBalance: number;
  maxDisplayedHolders: number;
  holders: Holder[];
  holderCount: number;
  displayedBalance: number;
  excludedLiquidityPool: {
    address: string;
    balance: number;
  } | null;
};

const TOKEN_MINT = "461C1ngHZtzTvMWT8gL7C2JLaYg2VQvaYj8aDFqhEni1";

function abbreviateMint(address: string) {
  if (address.length < 10) {
    return address;
  }

  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export default function Home() {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [displayedBalance, setDisplayedBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

        const data = (await response.json()) as HoldersResponse;

        if (cancelled) {
          return;
        }

        setHolders((data.holders ?? []).slice(0, 100));

        setDisplayedBalance(
          typeof data.displayedBalance === "number"
            ? data.displayedBalance
            : 0
        );
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load holders."
        );
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

  const visibleBalance = useMemo(() => {
    if (displayedBalance > 0) {
      return displayedBalance;
    }

    return holders.reduce(
      (total, holder) => total + holder.balance,
      0
    );
  }, [displayedBalance, holders]);

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(TOKEN_MINT);

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch (err) {
      console.error("Failed to copy mint:", err);
    }
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-white">
      {/* 3D moon */}
      <div className="absolute inset-0">
        <MoonScene holders={holders} />
      </div>

      {/* Top left */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 sm:left-8 sm:top-8">
        <span className="text-xl font-medium text-white sm:text-2xl">
          moondat.lol
        </span>

        {/* Mint address */}
        <div className="pointer-events-auto mt-1.5 flex items-center gap-1.5 sm:mt-2">
          <span className="text-[10px] text-white/35 sm:text-xs">
            {abbreviateMint(TOKEN_MINT)}
          </span>

          <button
            type="button"
            onClick={copyMint}
            aria-label={copied ? "Copied" : "Copy token address"}
            title={copied ? "Copied" : "Copy token address"}
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/35 transition-colors hover:text-white/70 active:scale-95"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>

      {/* Top right */}
      {!loading && !error && (
        <div className="pointer-events-none absolute right-4 top-4 z-10 text-right sm:right-8 sm:top-8">
          <div className="text-lg font-medium tabular-nums text-white sm:text-xl">
            {holders.length}
          </div>

          <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-white/30 sm:text-[10px]">
            displayed holders
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 sm:bottom-8">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 backdrop-blur-xl">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />

            <span className="whitespace-nowrap text-xs text-white/50">
              Mapping top holders...
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute bottom-6 left-1/2 z-10 w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-2xl border border-white/10 bg-black/75 p-4 text-center backdrop-blur-xl sm:bottom-8">
          <p className="text-sm text-white/65">{error}</p>
        </div>
      )}

      {/* Bottom right */}
      {!loading && !error && holders.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-10 text-right sm:bottom-8 sm:right-8">
          <div className="text-[9px] uppercase tracking-[0.16em] text-white/25 sm:text-[10px]">
            Surface area
          </div>

          <div className="mt-1 text-[10px] text-white/40 sm:text-xs">
            Proportional to holdings
          </div>
        </div>
      )}
    </main>
  );
}
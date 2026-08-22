import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_HOLDINGS = 100_000;
const MAX_DISPLAYED_HOLDERS = 100;
const PAGE_LIMIT = 1000;

const DAS_REQUEST_INTERVAL_MS = 700;
const MAX_RETRIES = 5;
const CACHE_TTL_MS = 60_000;

type HeliusTokenAccount = {
  address: string;
  mint: string;
  owner: string;
  amount: number | string;
  delegated_amount?: number;
  frozen?: boolean;
};

type TokenAccountsResponse = {
  result?: {
    total?: number;
    limit?: number;
    page?: number;
    token_accounts?: HeliusTokenAccount[];
  };
  error?: {
    code?: number;
    message?: string;
  };
};

type TokenSupplyResponse = {
  result?: {
    value?: {
      amount: string;
      decimals: number;
      uiAmount: number | null;
      uiAmountString: string;
    };
  };
  error?: {
    code?: number;
    message?: string;
  };
};

type Holder = {
  address: string;
  balance: number;
};

type HolderResponse = {
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

type CacheEntry = {
  expiresAt: number;
  data: HolderResponse;
};

const globalStore = globalThis as typeof globalThis & {
  __holderMoonCache?: Map<string, CacheEntry>;
  __holderMoonInFlight?: Map<string, Promise<HolderResponse>>;
  __holderMoonLastDasRequest?: number;
};

const holderCache =
  globalStore.__holderMoonCache ??
  new Map<string, CacheEntry>();

globalStore.__holderMoonCache = holderCache;

const inFlightRequests =
  globalStore.__holderMoonInFlight ??
  new Map<string, Promise<HolderResponse>>();

globalStore.__holderMoonInFlight = inFlightRequests;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isValidMint(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

async function waitForDasSlot() {
  const now = Date.now();

  const lastRequest =
    globalStore.__holderMoonLastDasRequest ?? 0;

  const elapsed = now - lastRequest;

  if (elapsed < DAS_REQUEST_INTERVAL_MS) {
    await sleep(DAS_REQUEST_INTERVAL_MS - elapsed);
  }

  globalStore.__holderMoonLastDasRequest = Date.now();
}

function getRetryDelay(
  response: Response,
  attempt: number
) {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (
      Number.isFinite(seconds) &&
      seconds > 0
    ) {
      return seconds * 1000;
    }
  }

  const exponential = Math.min(
    1000 * 2 ** attempt,
    30_000
  );

  return exponential + Math.random() * 300;
}

async function heliusRpc<T>(
  url: string,
  body: Record<string, unknown>,
  options?: {
    das?: boolean;
  }
): Promise<T> {
  let lastError: Error | null = null;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    if (options?.das) {
      await waitForDasSlot();
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      if (response.status === 429) {
        const delay = getRetryDelay(
          response,
          attempt
        );

        console.warn(
          `[holders] Helius 429 — retry ${
            attempt + 1
          }/${MAX_RETRIES} in ${Math.round(delay)}ms`
        );

        if (attempt >= MAX_RETRIES) {
          throw new Error(
            "Helius is currently rate limiting holder requests."
          );
        }

        await sleep(delay);

        continue;
      }

      if (
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        const delay = getRetryDelay(
          response,
          attempt
        );

        if (attempt >= MAX_RETRIES) {
          throw new Error(
            `Helius temporarily unavailable (${response.status}).`
          );
        }

        await sleep(delay);

        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");

        throw new Error(
          `Helius request failed with ${response.status}${
            text ? `: ${text.slice(0, 300)}` : ""
          }`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Unknown Helius error");

      throw lastError;
    }
  }

  throw (
    lastError ??
    new Error("Unable to complete Helius request.")
  );
}

async function scanHolders(
  mint: string,
  apiKey: string
): Promise<HolderResponse> {
  const rpcUrl =
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

  const supply =
    await heliusRpc<TokenSupplyResponse>(
      rpcUrl,
      {
        jsonrpc: "2.0",
        id: "holder-moon-supply",
        method: "getTokenSupply",
        params: [mint],
      }
    );

  if (supply.error) {
    throw new Error(
      supply.error.message ??
        "Unable to read token supply."
    );
  }

  const decimals =
    supply.result?.value?.decimals;

  if (
    decimals === undefined ||
    decimals === null
  ) {
    throw new Error(
      "Unable to determine token decimals."
    );
  }

  const divisor = 10 ** decimals;

  /*
   * Combine multiple token accounts belonging to
   * the same actual wallet.
   */
  const balances =
    new Map<string, number>();

  let page = 1;
  let rawTokenAccounts = 0;

  while (true) {
    console.log(
      `[holders] Fetching page ${page} for ${mint}`
    );

    const data =
      await heliusRpc<TokenAccountsResponse>(
        rpcUrl,
        {
          jsonrpc: "2.0",
          id: `holder-moon-${page}`,
          method: "getTokenAccounts",
          params: {
            mint,
            page,
            limit: PAGE_LIMIT,
            displayOptions: {},
          },
        },
        {
          das: true,
        }
      );

    if (data.error) {
      throw new Error(
        data.error.message ??
          "Unable to retrieve token accounts."
      );
    }

    const accounts =
      data.result?.token_accounts ?? [];

    if (accounts.length === 0) {
      break;
    }

    rawTokenAccounts += accounts.length;

    for (const account of accounts) {
      if (!account.owner) {
        continue;
      }

      const rawAmount =
        Number(account.amount);

      if (
        !Number.isFinite(rawAmount) ||
        rawAmount <= 0
      ) {
        continue;
      }

      const tokenAmount =
        rawAmount / divisor;

      balances.set(
        account.owner,
        (balances.get(account.owner) ?? 0) +
          tokenAmount
      );
    }

    if (
      accounts.length <
      PAGE_LIMIT
    ) {
      break;
    }

    page += 1;

    if (page > 10_000) {
      throw new Error(
        "Holder pagination exceeded safety limit."
      );
    }
  }

  /*
   * 1. Only wallets above 100k.
   * 2. Largest first.
   */
  const qualifyingHolders =
    Array.from(
      balances.entries()
    )
      .map(
        ([address, balance]) => ({
          address,
          balance,
        })
      )
      .filter(
        (holder) =>
          holder.balance >
          MIN_HOLDINGS
      )
      .sort(
        (a, b) =>
          b.balance -
          a.balance
      );

  /*
   * Largest holder is treated as LP and removed.
   */
  const excludedLiquidityPool =
    qualifyingHolders[0] ??
    null;

  /*
   * Remove LP FIRST.
   *
   * Then take only the 100 largest real wallets.
   */
  const holders =
    qualifyingHolders
      .slice(1)
      .slice(
        0,
        MAX_DISPLAYED_HOLDERS
      );

  const displayedBalance =
    holders.reduce(
      (sum, holder) =>
        sum +
        holder.balance,
      0
    );

  console.log(
    `[holders] ${rawTokenAccounts} token accounts → ` +
      `${balances.size} wallets → ` +
      `${qualifyingHolders.length} above 100k → ` +
      `${holders.length} displayed`
  );

  if (
    excludedLiquidityPool
  ) {
    console.log(
      `[holders] Excluded LP: ${excludedLiquidityPool.address} — ` +
        `${excludedLiquidityPool.balance.toLocaleString()} tokens`
    );
  }

  return {
    mint,
    minimumBalance:
      MIN_HOLDINGS,

    maxDisplayedHolders:
      MAX_DISPLAYED_HOLDERS,

    holders,

    holderCount:
      holders.length,

    displayedBalance,

    excludedLiquidityPool,
  };
}

async function getHolderData(
  mint: string,
  apiKey: string
) {
  const cached =
    holderCache.get(mint);

  if (
    cached &&
    cached.expiresAt >
      Date.now()
  ) {
    console.log(
      `[holders] Using cached data for ${mint}`
    );

    return cached.data;
  }

  const existingRequest =
    inFlightRequests.get(
      mint
    );

  if (existingRequest) {
    return existingRequest;
  }

  const request =
    scanHolders(
      mint,
      apiKey
    );

  inFlightRequests.set(
    mint,
    request
  );

  try {
    const data =
      await request;

    holderCache.set(
      mint,
      {
        data,
        expiresAt:
          Date.now() +
          CACHE_TTL_MS,
      }
    );

    return data;
  } finally {
    inFlightRequests.delete(
      mint
    );
  }
}

export async function GET(
  request: NextRequest
) {
  try {
    const mint =
      request.nextUrl.searchParams
        .get("mint")
        ?.trim() ?? "";

    if (
      !mint ||
      !isValidMint(mint)
    ) {
      return NextResponse.json(
        {
          error:
            "A valid Solana token mint is required.",
        },
        {
          status: 400,
        }
      );
    }

    const apiKey =
      process.env.HELIUS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "HELIUS_API_KEY is not configured. Add it to .env.local.",
        },
        {
          status: 500,
        }
      );
    }

    const data =
      await getHolderData(
        mint,
        apiKey
      );

    const response =
      NextResponse.json(
        data
      );

    response.headers.set(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=120"
    );

    return response;
  } catch (error) {
    console.error(
      "Holder API error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load token holders.",
      },
      {
        status: 500,
      }
    );
  }
}
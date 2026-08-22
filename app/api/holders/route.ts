import { NextRequest, NextResponse } from "next/server";
import { createHelius } from "helius-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/*                                   CONFIG                                   */
/* -------------------------------------------------------------------------- */

const MIN_HOLDINGS = 100_000;
const MAX_DISPLAYED_HOLDERS = 100;

const PAGE_SIZE = 1000;

/*
 * Helius can rate-limit DAS calls.
 * Keep pagination comfortably spaced.
 */
const PAGE_DELAY_MS = 650;

const MAX_RETRIES = 5;

/*
 * Don't rescan the entire mint every refresh.
 */
const CACHE_TIME_MS = 60_000;

/* -------------------------------------------------------------------------- */
/*                                    TYPES                                   */
/* -------------------------------------------------------------------------- */

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

  excludedLiquidityPool: Holder | null;

  totalWalletCount: number;
  qualifyingHolderCount: number;

  updatedAt: string;
};

type CacheEntry = {
  expiresAt: number;
  data: HolderResponse;
};

/* -------------------------------------------------------------------------- */
/*                              GLOBAL DEV CACHE                              */
/* -------------------------------------------------------------------------- */

const globalStore = globalThis as typeof globalThis & {
  __moonHolderCache?: Map<string, CacheEntry>;

  __moonHolderInFlight?: Map<
    string,
    Promise<HolderResponse>
  >;
};

const holderCache =
  globalStore.__moonHolderCache ??
  new Map<string, CacheEntry>();

globalStore.__moonHolderCache =
  holderCache;

const inFlight =
  globalStore.__moonHolderInFlight ??
  new Map<
    string,
    Promise<HolderResponse>
  >();

globalStore.__moonHolderInFlight =
  inFlight;

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isValidSolanaAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRateLimitError(error: unknown) {
  const message =
    getErrorMessage(error).toLowerCase();

  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  );
}

/* -------------------------------------------------------------------------- */
/*                          HELIUS PAGE WITH RETRIES                          */
/* -------------------------------------------------------------------------- */

async function getTokenAccountsPage(
  helius: ReturnType<typeof createHelius>,
  params: {
    mint: string;
    limit: number;
    cursor?: string;
  }
) {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      return await helius.getTokenAccounts({
        mint: params.mint,

        limit: params.limit,

        ...(params.cursor
          ? {
              cursor: params.cursor,
            }
          : {}),

        options: {
          showZeroBalance: false,
        },
      });
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error)) {
        throw error;
      }

      if (attempt >= MAX_RETRIES) {
        throw error;
      }

      const delay = Math.min(
        1000 * 2 ** attempt,
        15_000
      );

      console.warn(
        `[holders] Helius rate limit — retrying in ${delay}ms`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/* -------------------------------------------------------------------------- */
/*                           FETCH TOKEN ACCOUNTS                             */
/* -------------------------------------------------------------------------- */

async function fetchAllTokenAccounts(
  helius: ReturnType<typeof createHelius>,
  mint: string
) {
  const accounts: Array<{
    owner?: string;
    amount?: number;
  }> = [];

  let cursor: string | undefined;
  let page = 1;

  /*
   * Prevent a malformed/repeated cursor from producing
   * an infinite loop.
   */
  const seenCursors =
    new Set<string>();

  while (true) {
    if (page > 1) {
      await sleep(
        PAGE_DELAY_MS
      );
    }

    console.log(
      `[holders] Fetching Helius page ${page}`
    );

    const response =
      await getTokenAccountsPage(
        helius,
        {
          mint,
          limit:
            PAGE_SIZE,
          cursor,
        }
      );

    const batch =
      response.token_accounts ??
      [];

    console.log(
      `[holders] Page ${page}: ${batch.length} accounts`
    );

    for (const account of batch) {
      accounts.push({
        owner:
          account.owner,

        /*
         * IMPORTANT:
         *
         * Current Helius DAS/SDK response gives us
         * the token amount here.
         *
         * Do NOT divide by 10 ** decimals again.
         */
        amount:
          account.amount,
      });
    }

    /*
     * Helius may provide total.
     */
    if (
      typeof response.total ===
        "number" &&
      accounts.length >=
        response.total
    ) {
      break;
    }

    /*
     * A short response means we're done.
     */
    if (
      batch.length <
      PAGE_SIZE
    ) {
      break;
    }

    const nextCursor =
      response.cursor;

    if (!nextCursor) {
      /*
       * No cursor and full page.
       *
       * Current Helius supports cursor pagination,
       * but stop safely rather than accidentally
       * requesting the first page forever.
       */
      console.warn(
        "[holders] Full page returned without a cursor. Ending pagination."
      );

      break;
    }

    if (
      seenCursors.has(
        nextCursor
      )
    ) {
      console.warn(
        "[holders] Repeated Helius cursor. Ending pagination."
      );

      break;
    }

    seenCursors.add(
      nextCursor
    );

    cursor =
      nextCursor;

    page += 1;

    if (page > 10_000) {
      throw new Error(
        "Holder pagination exceeded safety limit."
      );
    }
  }

  return accounts;
}

/* -------------------------------------------------------------------------- */
/*                                SCAN HOLDERS                                */
/* -------------------------------------------------------------------------- */

async function scanHolders(
  mint: string,
  apiKey: string
): Promise<HolderResponse> {
  /*
   * CURRENT helius-sdk syntax.
   */
  const helius =
    createHelius({
      apiKey,
    });

  const tokenAccounts =
    await fetchAllTokenAccounts(
      helius,
      mint
    );

  console.log(
    `[holders] Fetched ${tokenAccounts.length} token accounts`
  );

  /*
   * Multiple SPL token accounts can belong to
   * the same wallet.
   *
   * Aggregate them by owner.
   */
  const walletBalances =
    new Map<
      string,
      number
    >();

  for (
    const account of tokenAccounts
  ) {
    const owner =
      account.owner?.trim();

    const amount =
      Number(
        account.amount ??
          0
      );

    if (!owner) {
      continue;
    }

    if (
      !Number.isFinite(
        amount
      ) ||
      amount <= 0
    ) {
      continue;
    }

    walletBalances.set(
      owner,

      (
        walletBalances.get(
          owner
        ) ?? 0
      ) + amount
    );
  }

  /*
   * Largest wallet first.
   */
  const allHolders =
    Array.from(
      walletBalances.entries()
    )
      .map(
        ([
          address,
          balance,
        ]) => ({
          address,
          balance,
        })
      )
      .filter(
        (holder) =>
          holder.balance > 0
      )
      .sort(
        (a, b) =>
          b.balance -
          a.balance
      );

  console.log(
    `[holders] ${allHolders.length} unique holder wallets`
  );

  /*
   * Per your requirement:
   *
   * absolute #1 wallet is treated as the LP
   * and excluded from the moon.
   */
  const excludedLiquidityPool =
    allHolders[0] ??
    null;

  /*
   * Remove LP FIRST.
   */
  const withoutLiquidityPool =
    allHolders.slice(1);

  /*
   * Now apply the minimum balance.
   */
  const qualifyingHolders =
    withoutLiquidityPool.filter(
      (holder) =>
        holder.balance >
        MIN_HOLDINGS
    );

  /*
   * Then take only the top 100.
   */
  const holders =
    qualifyingHolders.slice(
      0,
      MAX_DISPLAYED_HOLDERS
    );

  /*
   * MoonScene uses holder balances to calculate
   * each top-100 holder's proportional share.
   */
  const displayedBalance =
    holders.reduce(
      (
        total,
        holder
      ) =>
        total +
        holder.balance,
      0
    );

  console.log(
    `[holders] ${qualifyingHolders.length} non-LP wallets above ${MIN_HOLDINGS.toLocaleString()}`
  );

  console.log(
    `[holders] Displaying top ${holders.length}`
  );

  if (
    excludedLiquidityPool
  ) {
    console.log(
      `[holders] Excluded LP: ${excludedLiquidityPool.address} — ${excludedLiquidityPool.balance.toLocaleString()} tokens`
    );
  }

  /*
   * Print top 10 so we can immediately sanity-check
   * the returned balances.
   */
  console.log(
    "[holders] Top displayed holders:"
  );

  holders
    .slice(0, 10)
    .forEach(
      (
        holder,
        index
      ) => {
        console.log(
          `#${index + 1}`,
          holder.address,
          holder.balance.toLocaleString()
        );
      }
    );

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

    totalWalletCount:
      allHolders.length,

    qualifyingHolderCount:
      qualifyingHolders.length,

    updatedAt:
      new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*                              CACHE + DEDUPE                                */
/* -------------------------------------------------------------------------- */

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
      "[holders] Using cached result"
    );

    return cached.data;
  }

  /*
   * Stops Next dev mode / simultaneous browser requests
   * from launching two complete Helius scans.
   */
  const existing =
    inFlight.get(mint);

  if (existing) {
    console.log(
      "[holders] Joining active scan"
    );

    return existing;
  }

  const request =
    scanHolders(
      mint,
      apiKey
    );

  inFlight.set(
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
          CACHE_TIME_MS,
      }
    );

    return data;
  } finally {
    inFlight.delete(
      mint
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                                    ROUTE                                   */
/* -------------------------------------------------------------------------- */

export async function GET(
  request: NextRequest
) {
  try {
    const mint =
      request.nextUrl.searchParams
        .get("mint")
        ?.trim() ??
      "";

    if (
      !mint ||
      !isValidSolanaAddress(
        mint
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Updating with Token CA",
        },
        {
          status: 400,
        }
      );
    }

    const apiKey =
      process.env
        .HELIUS_API_KEY
        ?.trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "HELIUS_API_KEY is missing from .env.local.",
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

    return NextResponse.json(
      data,
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error(
      "[holders] API error:",
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
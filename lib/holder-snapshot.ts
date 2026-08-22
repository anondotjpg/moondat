import "server-only";

import {
  MAX_DISPLAYED_HOLDERS,
  MIN_HOLDINGS,
} from "@/lib/token-config";

const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const MAX_RETRIES = 4;

export type Holder = {
  address: string;
  balance: number;
};

export type HolderSnapshot = {
  mint: string;

  minimumBalance: number;
  maxDisplayedHolders: number;

  holders: Holder[];
  holderCount: number;

  displayedBalance: number;

  excludedTopHolder: Holder | null;

  totalWalletCount: number;
  qualifyingHolderCount: number;

  updatedAt: string;
};

type ParsedTokenAccount = {
  pubkey: string;

  account: {
    data: {
      program?: string;

      parsed?: {
        info?: {
          mint?: string;

          owner?: string;

          tokenAmount?: {
            amount?: string;
            decimals?: number;
            uiAmount?: number | null;
            uiAmountString?: string;
          };
        };
      };
    };
  };
};

type ProgramAccountsResponse = {
  jsonrpc?: string;
  id?: number;

  result?: ParsedTokenAccount[];

  error?: {
    code?: number;
    message?: string;
  };
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryDelay(attempt: number) {
  return Math.min(
    1000 * 2 ** attempt,
    15_000
  );
}

async function fetchProgramAccounts(
  mint: string,
  apiKey: string
) {
  const url =
    `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(
      apiKey
    )}`;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,

        method: "getProgramAccounts",

        params: [
          TOKEN_PROGRAM_ID,

          {
            /*
             * Gives us owner + properly adjusted
             * uiAmountString directly.
             */
            encoding: "jsonParsed",

            commitment: "confirmed",

            filters: [
              /*
               * Standard SPL token account size.
               */
              {
                dataSize: 165,
              },

              /*
               * First 32 bytes of a token account
               * are its mint.
               */
              {
                memcmp: {
                  offset: 0,
                  bytes: mint,
                },
              },
            ],
          },
        ],
      }),

      cache: "no-store",
    });

    if (
      response.status === 429 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
    ) {
      if (
        attempt >= MAX_RETRIES
      ) {
        throw new Error(
          `Helius failed after retries (${response.status})`
        );
      }

      const retryAfter =
        response.headers.get(
          "retry-after"
        );

      let delay =
        getRetryDelay(
          attempt
        );

      if (retryAfter) {
        const seconds =
          Number(retryAfter);

        if (
          Number.isFinite(
            seconds
          ) &&
          seconds > 0
        ) {
          delay =
            seconds * 1000;
        }
      }

      console.warn(
        `[holder-sync] Helius ${response.status}; retrying in ${delay}ms`
      );

      await sleep(delay);

      continue;
    }

    if (!response.ok) {
      const text =
        await response
          .text()
          .catch(() => "");

      throw new Error(
        `Helius request failed (${response.status})${
          text
            ? `: ${text.slice(
                0,
                300
              )}`
            : ""
        }`
      );
    }

    const data =
      (await response.json()) as ProgramAccountsResponse;

    if (data.error) {
      throw new Error(
        data.error.message ??
          "Helius RPC error"
      );
    }

    if (
      !Array.isArray(
        data.result
      )
    ) {
      throw new Error(
        "Helius returned an invalid getProgramAccounts response"
      );
    }

    return data.result;
  }

  throw new Error(
    "Unable to retrieve token accounts"
  );
}

function getUiBalance(
  account: ParsedTokenAccount
) {
  const tokenAmount =
    account.account.data
      .parsed?.info
      ?.tokenAmount;

  if (!tokenAmount) {
    return null;
  }

  /*
   * Prefer uiAmountString.
   *
   * This has already accounted for token decimals.
   */
  if (
    typeof tokenAmount.uiAmountString ===
    "string"
  ) {
    const balance =
      Number(
        tokenAmount.uiAmountString
      );

    if (
      Number.isFinite(
        balance
      )
    ) {
      return balance;
    }
  }

  /*
   * Fallback.
   */
  if (
    typeof tokenAmount.amount ===
      "string" &&
    typeof tokenAmount.decimals ===
      "number"
  ) {
    const raw =
      Number(
        tokenAmount.amount
      );

    const balance =
      raw /
      10 **
        tokenAmount.decimals;

    if (
      Number.isFinite(
        balance
      )
    ) {
      return balance;
    }
  }

  return null;
}

export async function buildHolderSnapshot(
  mint: string
): Promise<HolderSnapshot> {
  const apiKey =
    process.env
      .HELIUS_API_KEY
      ?.trim();

  if (!apiKey) {
    throw new Error(
      "Missing HELIUS_API_KEY"
    );
  }

  console.log(
    `[holder-sync] syncing ${mint}`
  );

  const tokenAccounts =
    await fetchProgramAccounts(
      mint,
      apiKey
    );

  console.log(
    `[holder-sync] received ${tokenAccounts.length} token accounts`
  );

  /*
   * Multiple SPL token accounts can belong
   * to one actual wallet.
   */
  const balances =
    new Map<
      string,
      number
    >();

  for (
    const tokenAccount of tokenAccounts
  ) {
    const info =
      tokenAccount.account.data
        .parsed?.info;

    const owner =
      info?.owner?.trim();

    if (!owner) {
      continue;
    }

    const balance =
      getUiBalance(
        tokenAccount
      );

    if (
      balance === null ||
      balance <= 0
    ) {
      continue;
    }

    balances.set(
      owner,

      (
        balances.get(
          owner
        ) ?? 0
      ) + balance
    );
  }

  /*
   * Largest -> smallest.
   */
  const allHolders =
    Array.from(
      balances.entries()
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
      .sort(
        (a, b) =>
          b.balance -
          a.balance
      );

  /*
   * Your current rule:
   *
   * remove absolute largest holder.
   */
  const excludedTopHolder =
    allHolders[0] ??
    null;

  const withoutTop =
    allHolders.slice(1);

  /*
   * Only holders > 100k.
   */
  const qualifying =
    withoutTop.filter(
      (holder) =>
        holder.balance >
        MIN_HOLDINGS
    );

  /*
   * Only top 100.
   */
  const holders =
    qualifying.slice(
      0,
      MAX_DISPLAYED_HOLDERS
    );

  const displayedBalance =
    holders.reduce(
      (
        sum,
        holder
      ) =>
        sum +
        holder.balance,
      0
    );

  console.log(
    `[holder-sync] ${allHolders.length} wallets`
  );

  console.log(
    `[holder-sync] ${qualifying.length} above ${MIN_HOLDINGS.toLocaleString()} after top-holder exclusion`
  );

  console.log(
    `[holder-sync] storing ${holders.length} holders`
  );

  if (
    excludedTopHolder
  ) {
    console.log(
      `[holder-sync] removed top holder: ${excludedTopHolder.address} (${excludedTopHolder.balance.toLocaleString()})`
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

    excludedTopHolder,

    totalWalletCount:
      allHolders.length,

    qualifyingHolderCount:
      qualifying.length,

    updatedAt:
      new Date().toISOString(),
  };
}
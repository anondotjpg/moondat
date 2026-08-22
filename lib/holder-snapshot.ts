import "server-only";

import {
  MAX_DISPLAYED_HOLDERS,
  MIN_HOLDINGS,
} from "@/lib/token-config";

/* -------------------------------------------------------------------------- */
/*                              TOKEN PROGRAMS                                */
/* -------------------------------------------------------------------------- */

const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const MAX_RETRIES = 4;

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

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

type RpcResponse<T> = {
  jsonrpc?: string;
  id?: number;

  result?: T;

  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type MintAccountInfoResult = {
  value: {
    owner: string;

    data: unknown;

    executable: boolean;
    lamports: number;
  } | null;
};

type ParsedTokenAccount = {
  pubkey: string;

  account: {
    data: {
      program?: string;

      parsed?: {
        type?: string;

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

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

function sleep(
  ms: number
) {
  return new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}

function getRetryDelay(
  attempt: number
) {
  return Math.min(
    1000 *
      2 ** attempt,

    15_000
  );
}

/* -------------------------------------------------------------------------- */
/*                               HELIUS RPC                                   */
/* -------------------------------------------------------------------------- */

async function heliusRpc<T>(
  apiKey: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const url =
    `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(
      apiKey
    )}`;

  for (
    let attempt = 0;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    const response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              jsonrpc:
                "2.0",

              id: 1,

              method,

              params,
            }),

          cache:
            "no-store",
        }
      );

    /*
     * Retry transient RPC errors.
     */
    if (
      response.status ===
        429 ||
      response.status ===
        500 ||
      response.status ===
        502 ||
      response.status ===
        503 ||
      response.status ===
        504
    ) {
      if (
        attempt >=
        MAX_RETRIES
      ) {
        throw new Error(
          `Helius ${method} failed after retries (${response.status})`
        );
      }

      let delay =
        getRetryDelay(
          attempt
        );

      const retryAfter =
        response.headers.get(
          "retry-after"
        );

      if (
        retryAfter
      ) {
        const seconds =
          Number(
            retryAfter
          );

        if (
          Number.isFinite(
            seconds
          ) &&
          seconds > 0
        ) {
          delay =
            seconds *
            1000;
        }
      }

      console.warn(
        `[holder-sync] ${method} returned ${response.status}; retrying in ${delay}ms`
      );

      await sleep(
        delay
      );

      continue;
    }

    if (
      !response.ok
    ) {
      const text =
        await response
          .text()
          .catch(
            () => ""
          );

      throw new Error(
        `Helius ${method} failed (${response.status})${
          text
            ? `: ${text.slice(
                0,
                500
              )}`
            : ""
        }`
      );
    }

    const data =
      (await response.json()) as RpcResponse<T>;

    if (
      data.error
    ) {
      throw new Error(
        `Helius ${method}: ${
          data.error
            .message ??
          "RPC error"
        }`
      );
    }

    if (
      data.result ===
      undefined
    ) {
      throw new Error(
        `Helius ${method} returned no result`
      );
    }

    return data.result;
  }

  throw new Error(
    `Helius ${method} failed`
  );
}

/* -------------------------------------------------------------------------- */
/*                        DETECT TOKEN PROGRAM                                */
/* -------------------------------------------------------------------------- */

async function getMintProgram(
  mint: string,
  apiKey: string
) {
  /*
   * Ask Solana which program owns the mint itself.
   *
   * That tells us whether this token uses:
   *
   * - original SPL Token
   * - Token-2022
   */
  const result =
    await heliusRpc<MintAccountInfoResult>(
      apiKey,

      "getAccountInfo",

      [
        mint,

        {
          encoding:
            "base64",

          commitment:
            "confirmed",
        },
      ]
    );

  if (
    !result.value
  ) {
    throw new Error(
      `Mint does not exist: ${mint}`
    );
  }

  const owner =
    result.value.owner;

  console.log(
    `[holder-sync] mint owner program: ${owner}`
  );

  if (
    owner ===
    TOKEN_PROGRAM_ID
  ) {
    console.log(
      "[holder-sync] token type: SPL Token"
    );

    return owner;
  }

  if (
    owner ===
    TOKEN_2022_PROGRAM_ID
  ) {
    console.log(
      "[holder-sync] token type: Token-2022"
    );

    return owner;
  }

  throw new Error(
    `Unsupported mint owner program: ${owner}`
  );
}

/* -------------------------------------------------------------------------- */
/*                         GET ALL TOKEN ACCOUNTS                             */
/* -------------------------------------------------------------------------- */

async function fetchTokenAccounts(
  mint: string,
  programId: string,
  apiKey: string
) {
  console.log(
    `[holder-sync] querying program ${programId}`
  );

  const accounts =
    await heliusRpc<
      ParsedTokenAccount[]
    >(
      apiKey,

      "getProgramAccounts",

      [
        programId,

        {
          encoding:
            "jsonParsed",

          commitment:
            "confirmed",

          filters: [
            /*
             * First 32 bytes of a token account
             * contain the mint address.
             *
             * DO NOT add dataSize: 165 here.
             *
             * Token-2022 accounts may contain
             * extensions and therefore be larger.
             */
            {
              memcmp: {
                offset: 0,
                bytes: mint,
              },
            },
          ],
        },
      ]
    );

  console.log(
    `[holder-sync] received ${accounts.length} token accounts`
  );

  /*
   * Do not let a malformed query erase an existing
   * good Supabase snapshot.
   */
  if (
    accounts.length ===
    0
  ) {
    throw new Error(
      `Helius returned 0 token accounts for ${mint}; refusing to store an empty snapshot`
    );
  }

  return accounts;
}

/* -------------------------------------------------------------------------- */
/*                             TOKEN BALANCE                                  */
/* -------------------------------------------------------------------------- */

function getUiBalance(
  account: ParsedTokenAccount
) {
  const tokenAmount =
    account.account.data
      .parsed?.info
      ?.tokenAmount;

  if (
    !tokenAmount
  ) {
    return null;
  }

  /*
   * Best representation because it has already
   * accounted for token decimals.
   */
  if (
    typeof tokenAmount
      .uiAmountString ===
    "string"
  ) {
    const balance =
      Number(
        tokenAmount
          .uiAmountString
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
   * Secondary parsed representation.
   */
  if (
    typeof tokenAmount
      .uiAmount ===
      "number" &&
    Number.isFinite(
      tokenAmount.uiAmount
    )
  ) {
    return tokenAmount.uiAmount;
  }

  /*
   * Raw integer fallback.
   */
  if (
    typeof tokenAmount
      .amount ===
      "string" &&
    typeof tokenAmount
      .decimals ===
      "number"
  ) {
    const raw =
      Number(
        tokenAmount.amount
      );

    if (
      !Number.isFinite(
        raw
      )
    ) {
      return null;
    }

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

/* -------------------------------------------------------------------------- */
/*                           BUILD HOLDER SNAPSHOT                            */
/* -------------------------------------------------------------------------- */

export async function buildHolderSnapshot(
  mint: string
): Promise<HolderSnapshot> {
  const apiKey =
    process.env
      .HELIUS_API_KEY
      ?.trim();

  if (
    !apiKey
  ) {
    throw new Error(
      "Missing HELIUS_API_KEY"
    );
  }

  console.log(
    `[holder-sync] syncing ${mint}`
  );

  /*
   * Step 1:
   *
   * Detect SPL Token vs Token-2022.
   */
  const programId =
    await getMintProgram(
      mint,
      apiKey
    );

  /*
   * Step 2:
   *
   * Find every token account for the mint.
   */
  const tokenAccounts =
    await fetchTokenAccounts(
      mint,
      programId,
      apiKey
    );

  /*
   * Step 3:
   *
   * Aggregate token accounts by wallet owner.
   *
   * A wallet can own multiple token accounts for
   * the same mint, so we MUST combine them.
   */
  const walletBalances =
    new Map<
      string,
      number
    >();

  let parsedAccounts =
    0;

  let skippedAccounts =
    0;

  for (
    const tokenAccount of
    tokenAccounts
  ) {
    const info =
      tokenAccount.account
        .data.parsed
        ?.info;

    const owner =
      info?.owner?.trim();

    if (
      !owner
    ) {
      skippedAccounts++;

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
      skippedAccounts++;

      continue;
    }

    parsedAccounts++;

    walletBalances.set(
      owner,

      (
        walletBalances.get(
          owner
        ) ??
        0
      ) +
        balance
    );
  }

  console.log(
    `[holder-sync] parsed ${parsedAccounts} positive token accounts`
  );

  console.log(
    `[holder-sync] skipped ${skippedAccounts} empty/unparseable accounts`
  );

  /*
   * Largest holder first.
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
          holder.balance >
          0
      )
      .sort(
        (a, b) =>
          b.balance -
          a.balance
      );

  console.log(
    `[holder-sync] ${allHolders.length} unique wallets`
  );

  /*
   * Second safety check.
   */
  if (
    allHolders.length ===
    0
  ) {
    throw new Error(
      `No positive holder wallets parsed for ${mint}; refusing to overwrite stored snapshot`
    );
  }

  /*
   * Your rule:
   *
   * remove absolute largest holder.
   */
  const excludedTopHolder =
    allHolders[0] ??
    null;

  const withoutTop =
    allHolders.slice(
      1
    );

  /*
   * Only wallets holding >100,000 tokens.
   */
  const qualifying =
    withoutTop.filter(
      (holder) =>
        holder.balance >
        MIN_HOLDINGS
    );

  /*
   * Moon shows maximum 100.
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

  console.log(
    "[holder-sync] top displayed holders:"
  );

  holders
    .slice(
      0,
      10
    )
    .forEach(
      (
        holder,
        index
      ) => {
        console.log(
          `[holder-sync] #${index + 1} ${holder.address} — ${holder.balance.toLocaleString()}`
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

    excludedTopHolder,

    totalWalletCount:
      allHolders.length,

    qualifyingHolderCount:
      qualifying.length,

    updatedAt:
      new Date().toISOString(),
  };
}
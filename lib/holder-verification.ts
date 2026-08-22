import "server-only";

import {
  supabaseAdmin,
} from "@/lib/supabase-admin";

import {
  TOKEN_MINT,
} from "@/lib/token-config";

export const VERIFICATION_AMOUNT_LAMPORTS =
  10_000_000;

export const VERIFICATION_AMOUNT_SOL =
  0.01;

export const VERIFICATION_LIFETIME_MS =
  15 * 60 * 1000;

const HELIUS_PAGE_LIMIT =
  100;

const MAX_HELIUS_PAGES =
  5;

type Holder = {
  address: string;
  balance: number;
};

type NativeTransfer = {
  fromUserAccount?: string;
  toUserAccount?: string;
  amount?: number;
};

type EnhancedTransaction = {
  signature?: string;
  timestamp?: number;

  transactionError?:
    | unknown
    | null;

  nativeTransfers?:
    NativeTransfer[];
};

export function normalizeHolderMessage(
  value: unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value
    .replace(
      /[\u0000-\u001F\u007F]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      120
    );
}

export function looksLikeSolanaAddress(
  value: string
) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(
    value
  );
}

export function getVerificationWallet() {
  const wallet =
    process.env
      .HOLDER_VERIFICATION_WALLET
      ?.trim();

  if (!wallet) {
    throw new Error(
      "HOLDER_VERIFICATION_WALLET is not configured."
    );
  }

  if (
    !looksLikeSolanaAddress(
      wallet
    )
  ) {
    throw new Error(
      "HOLDER_VERIFICATION_WALLET is invalid."
    );
  }

  return wallet;
}

export async function getCurrentTopHolder(
  walletAddress: string
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "token_holder_snapshots"
      )
      .select(
        "holders"
      )
      .eq(
        "mint",
        TOKEN_MINT
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "Holder snapshot is not available."
    );
  }

  const holders =
    (
      data.holders ??
      []
    ) as Holder[];

  return (
    holders.find(
      (holder) =>
        holder.address ===
        walletAddress
    ) ??
    null
  );
}

async function getHeliusTransactions(
  destinationWallet: string,
  createdAt: Date,
  beforeSignature?: string
) {
  const apiKey =
    process.env
      .HELIUS_API_KEY
      ?.trim();

  if (!apiKey) {
    throw new Error(
      "HELIUS_API_KEY is missing."
    );
  }

  const createdAtSeconds =
    Math.floor(
      createdAt.getTime() /
        1000
    );

  const params =
    new URLSearchParams();

  params.set(
    "api-key",
    apiKey
  );

  params.set(
    "gte-time",
    String(
      createdAtSeconds
    )
  );

  params.set(
    "commitment",
    "confirmed"
  );

  params.set(
    "sort-order",
    "desc"
  );

  params.set(
    "type",
    "TRANSFER"
  );

  params.set(
    "token-accounts",
    "none"
  );

  params.set(
    "limit",
    String(
      HELIUS_PAGE_LIMIT
    )
  );

  if (
    beforeSignature
  ) {
    params.set(
      "before-signature",
      beforeSignature
    );
  }

  const response =
    await fetch(
      `https://api-mainnet.helius-rpc.com/v0/addresses/${encodeURIComponent(
        destinationWallet
      )}/transactions?${params.toString()}`,
      {
        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    const text =
      await response
        .text()
        .catch(
          () => ""
        );

    throw new Error(
      `Helius transaction lookup failed (${response.status})${
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
    (await response.json()) as EnhancedTransaction[];

  if (
    !Array.isArray(
      data
    )
  ) {
    throw new Error(
      "Helius returned an invalid transaction response."
    );
  }

  return data;
}

export async function findVerificationTransfer({
  sourceWallet,
  destinationWallet,
  amountLamports,
  createdAt,
}: {
  sourceWallet: string;
  destinationWallet: string;
  amountLamports: number;
  createdAt: Date;
}) {
  const minimumTimestamp =
    Math.floor(
      createdAt.getTime() /
        1000
    );

  let beforeSignature:
    | string
    | undefined;

  for (
    let page = 0;
    page <
    MAX_HELIUS_PAGES;
    page++
  ) {
    const transactions =
      await getHeliusTransactions(
        destinationWallet,
        createdAt,
        beforeSignature
      );

    if (
      transactions.length ===
      0
    ) {
      break;
    }

    for (
      const transaction of
      transactions
    ) {
      if (
        !transaction.signature
      ) {
        continue;
      }

      /*
       * Failed Solana transaction.
       */
      if (
        transaction.transactionError !=
        null
      ) {
        continue;
      }

      if (
        typeof transaction.timestamp ===
          "number" &&
        transaction.timestamp <
          minimumTimestamp
      ) {
        continue;
      }

      const transfers =
        transaction.nativeTransfers ??
        [];

      const matchingTransfer =
        transfers.find(
          (transfer) =>
            transfer.fromUserAccount ===
              sourceWallet &&
            transfer.toUserAccount ===
              destinationWallet &&
            Number(
              transfer.amount
            ) ===
              amountLamports
        );

      if (
        matchingTransfer
      ) {
        return {
          signature:
            transaction.signature,

          timestamp:
            transaction.timestamp ??
            null,
        };
      }
    }

    if (
      transactions.length <
      HELIUS_PAGE_LIMIT
    ) {
      break;
    }

    const last =
      transactions[
        transactions.length -
          1
      ];

    if (
      !last?.signature
    ) {
      break;
    }

    beforeSignature =
      last.signature;
  }

  return null;
}
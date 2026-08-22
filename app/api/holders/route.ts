import {
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase-admin";

import {
  TOKEN_MINT,
} from "@/lib/token-config";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

type Holder = {
  address: string;
  balance: number;
};

type VerifiedMessage = {
  wallet_address: string;
  message: string;
  verified_at: string;
};

export async function GET() {
  try {
    /* -------------------------------------------------------------------- */
    /* HOLDER SNAPSHOT                                                       */
    /* -------------------------------------------------------------------- */

    const {
      data: snapshot,
      error: snapshotError,
    } =
      await supabaseAdmin
        .from(
          "token_holder_snapshots"
        )
        .select(
          `
            mint,
            minimum_balance,
            max_displayed_holders,
            holders,
            holder_count,
            displayed_balance,
            excluded_top_holder,
            total_wallet_count,
            qualifying_holder_count,
            updated_at
          `
        )
        .eq(
          "mint",
          TOKEN_MINT
        )
        .maybeSingle();

    if (
      snapshotError
    ) {
      console.error(
        "[holders-api] snapshot error:",
        snapshotError
      );

      return NextResponse.json(
        {
          error:
            snapshotError.message ||
            "Unable to read holder snapshot.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !snapshot
    ) {
      return NextResponse.json(
        {
          error:
            "Holder snapshot has not been created yet.",
        },
        {
          status: 503,
        }
      );
    }

    const holders =
      Array.isArray(
        snapshot.holders
      )
        ? (
            snapshot.holders as Holder[]
          )
        : [];

    /* -------------------------------------------------------------------- */
    /* VERIFIED MESSAGES                                                     */
    /* -------------------------------------------------------------------- */

    /*
     * Verification messages are OPTIONAL enrichment.
     *
     * If this table/query fails for any reason,
     * DO NOT break the holder moon.
     */
    const verifiedByWallet =
      new Map<
        string,
        VerifiedMessage
      >();

    const addresses =
      holders
        .map(
          (
            holder
          ) =>
            holder.address
        )
        .filter(
          Boolean
        );

    if (
      addresses.length >
      0
    ) {
      try {
        const {
          data:
            verifiedMessages,
          error:
            verifiedError,
        } =
          await supabaseAdmin
            .from(
              "verified_holder_messages"
            )
            .select(
              `
                wallet_address,
                message,
                verified_at
              `
            )
            .eq(
              "mint",
              TOKEN_MINT
            )
            .in(
              "wallet_address",
              addresses
            );

        if (
          verifiedError
        ) {
          console.error(
            "[holders-api] verified message lookup failed:",
            verifiedError
          );
        } else {
          for (
            const item of
            verifiedMessages ??
            []
          ) {
            if (
              !item.wallet_address
            ) {
              continue;
            }

            verifiedByWallet.set(
              item.wallet_address,
              {
                wallet_address:
                  item.wallet_address,

                message:
                  item.message,

                verified_at:
                  item.verified_at,
              }
            );
          }
        }
      } catch (
        verificationError
      ) {
        /*
         * Never let verification enrichment
         * take down the core holder endpoint.
         */
        console.error(
          "[holders-api] verification enrichment error:",
          verificationError
        );
      }
    }

    /* -------------------------------------------------------------------- */
    /* ENRICH HOLDERS                                                        */
    /* -------------------------------------------------------------------- */

    const enrichedHolders =
      holders.map(
        (
          holder
        ) => {
          const verified =
            verifiedByWallet.get(
              holder.address
            );

          return {
            address:
              holder.address,

            balance:
              holder.balance,

            verified:
              Boolean(
                verified
              ),

            message:
              verified?.message ??
              null,

            verifiedAt:
              verified?.verified_at ??
              null,
          };
        }
      );

    /* -------------------------------------------------------------------- */
    /* RESPONSE                                                              */
    /* -------------------------------------------------------------------- */

    return NextResponse.json(
      {
        mint:
          snapshot.mint,

        minimumBalance:
          snapshot.minimum_balance,

        maxDisplayedHolders:
          snapshot.max_displayed_holders,

        holders:
          enrichedHolders,

        holderCount:
          enrichedHolders.length,

        displayedBalance:
          snapshot.displayed_balance,

        excludedLiquidityPool:
          snapshot.excluded_top_holder,

        totalWalletCount:
          snapshot.total_wallet_count,

        qualifyingHolderCount:
          snapshot.qualifying_holder_count,

        updatedAt:
          snapshot.updated_at,
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (
    error
  ) {
    console.error(
      "[holders-api] fatal:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to load holders.",
      },
      {
        status: 500,
      }
    );
  }
}
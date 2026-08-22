import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { TOKEN_MINT } from "@/lib/token-config";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET() {
  try {
    const {
      data,
      error,
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

    if (error) {
      throw error;
    }

    if (!data) {
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

    return NextResponse.json(
      {
        mint:
          data.mint,

        minimumBalance:
          data.minimum_balance,

        maxDisplayedHolders:
          data.max_displayed_holders,

        holders:
          data.holders ?? [],

        holderCount:
          data.holder_count,

        displayedBalance:
          data.displayed_balance,

        /*
         * Preserve the property your existing
         * page.tsx already expects.
         */
        excludedLiquidityPool:
          data.excluded_top_holder,

        totalWalletCount:
          data.total_wallet_count,

        qualifyingHolderCount:
          data.qualifying_holder_count,

        updatedAt:
          data.updated_at,
      },
      {
        headers: {
          /*
           * Always serve the DB's latest snapshot.
           */
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "[holders-api]",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load holder snapshot",
      },
      {
        status: 500,
      }
    );
  }
}
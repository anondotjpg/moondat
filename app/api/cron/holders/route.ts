import { NextResponse } from "next/server";

import { buildHolderSnapshot } from "@/lib/holder-snapshot";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TOKEN_MINT } from "@/lib/token-config";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;

export async function GET(
  request: Request
) {
  try {
    /*
     * Vercel cron security.
     */
    const cronSecret =
      process.env
        .CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json(
        {
          error:
            "CRON_SECRET is not configured",
        },
        {
          status: 500,
        }
      );
    }

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (
      authorization !==
      `Bearer ${cronSecret}`
    ) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    /*
     * Avoid unnecessary duplicate runs if the
     * endpoint gets invoked twice close together.
     */
    const {
      data: existing,
      error:
        existingError,
    } =
      await supabaseAdmin
        .from(
          "token_holder_snapshots"
        )
        .select(
          "updated_at"
        )
        .eq(
          "mint",
          TOKEN_MINT
        )
        .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (
      existing?.updated_at
    ) {
      const age =
        Date.now() -
        new Date(
          existing.updated_at
        ).getTime();

      /*
       * If another run already updated less than
       * 45 seconds ago, don't hit Helius again.
       */
      if (
        age >= 0 &&
        age < 45_000
      ) {
        return NextResponse.json(
          {
            ok: true,
            skipped: true,
            reason:
              "Snapshot is already fresh",
            updatedAt:
              existing.updated_at,
          }
        );
      }
    }

    const snapshot =
      await buildHolderSnapshot(
        TOKEN_MINT
      );

    /*
     * One persistent row per token mint.
     *
     * Every minute we overwrite it with the
     * newest holder snapshot.
     */
    const {
      error:
        upsertError,
    } =
      await supabaseAdmin
        .from(
          "token_holder_snapshots"
        )
        .upsert(
          {
            mint:
              snapshot.mint,

            minimum_balance:
              snapshot.minimumBalance,

            max_displayed_holders:
              snapshot.maxDisplayedHolders,

            holders:
              snapshot.holders,

            holder_count:
              snapshot.holderCount,

            displayed_balance:
              snapshot.displayedBalance,

            excluded_top_holder:
              snapshot.excludedTopHolder,

            total_wallet_count:
              snapshot.totalWalletCount,

            qualifying_holder_count:
              snapshot.qualifyingHolderCount,

            updated_at:
              snapshot.updatedAt,
          },
          {
            onConflict:
              "mint",
          }
        );

    if (upsertError) {
      throw upsertError;
    }

    console.log(
      `[holder-cron] saved ${snapshot.holderCount} holders at ${snapshot.updatedAt}`
    );

    return NextResponse.json(
      {
        ok: true,

        holderCount:
          snapshot.holderCount,

        qualifyingHolderCount:
          snapshot.qualifyingHolderCount,

        updatedAt:
          snapshot.updatedAt,
      }
    );
  } catch (error) {
    console.error(
      "[holder-cron]",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Holder sync failed",
      },
      {
        status: 500,
      }
    );
  }
}
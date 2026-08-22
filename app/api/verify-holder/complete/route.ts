import {
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase-admin";

import {
  TOKEN_MINT,
} from "@/lib/token-config";

import {
  findVerificationTransfer,
  getCurrentTopHolder,
} from "@/lib/holder-verification";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const challengeId =
      typeof body
        ?.challengeId ===
      "string"
        ? body.challengeId.trim()
        : "";

    if (
      !challengeId
    ) {
      return NextResponse.json(
        {
          error:
            "Missing verification request.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      data:
        challenge,
      error:
        challengeError,
    } =
      await supabaseAdmin
        .from(
          "holder_verification_challenges"
        )
        .select(
          `
            id,
            mint,
            wallet_address,
            message,
            destination_wallet,
            amount_lamports,
            created_at,
            expires_at,
            verified_at,
            verification_tx_signature
          `
        )
        .eq(
          "id",
          challengeId
        )
        .maybeSingle();

    if (
      challengeError
    ) {
      throw challengeError;
    }

    if (
      !challenge
    ) {
      return NextResponse.json(
        {
          error:
            "Verification request not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      challenge.mint !==
      TOKEN_MINT
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid verification request.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      challenge.verified_at ||
      challenge.verification_tx_signature
    ) {
      return NextResponse.json(
        {
          error:
            "This verification request has already been completed.",
        },
        {
          status: 409,
        }
      );
    }

    if (
      new Date(
        challenge.expires_at
      ).getTime() <=
      Date.now()
    ) {
      return NextResponse.json(
        {
          error:
            "Verification expired. Start a new one.",
        },
        {
          status: 410,
        }
      );
    }

    /*
     * Re-check holder status immediately before
     * accepting the payment.
     */
    const holder =
      await getCurrentTopHolder(
        challenge.wallet_address
      );

    if (!holder) {
      return NextResponse.json(
        {
          error:
            "That wallet is no longer a displayed top holder.",
        },
        {
          status: 403,
        }
      );
    }

    const transfer =
      await findVerificationTransfer(
        {
          sourceWallet:
            challenge.wallet_address,

          destinationWallet:
            challenge.destination_wallet,

          amountLamports:
            Number(
              challenge.amount_lamports
            ),

          createdAt:
            new Date(
              challenge.created_at
            ),
        }
      );

    if (!transfer) {
      return NextResponse.json(
        {
          found: false,

          error:
            "No matching 0.01 SOL transfer found yet. Make sure it was sent directly from the holder wallet, then try again.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Extra friendly pre-check.
     *
     * The DB also has a unique constraint,
     * so this is protected against races.
     */
    const {
      data:
        alreadyUsed,
      error:
        usedError,
    } =
      await supabaseAdmin
        .from(
          "holder_verification_challenges"
        )
        .select(
          "id"
        )
        .eq(
          "verification_tx_signature",
          transfer.signature
        )
        .maybeSingle();

    if (usedError) {
      throw usedError;
    }

    if (
      alreadyUsed &&
      alreadyUsed.id !==
        challenge.id
    ) {
      return NextResponse.json(
        {
          error:
            "That transaction has already been used for verification.",
        },
        {
          status: 409,
        }
      );
    }

    /*
     * Atomically:
     *
     * 1. consume transaction
     * 2. mark challenge verified
     * 3. publish message
     */
    const {
      data:
        finalized,
      error:
        finalizeError,
    } =
      await supabaseAdmin.rpc(
        "finalize_holder_verification",
        {
          p_challenge_id:
            challenge.id,

          p_tx_signature:
            transfer.signature,
        }
      );

    if (
      finalizeError
    ) {
      throw finalizeError;
    }

    if (
      finalized !==
      true
    ) {
      return NextResponse.json(
        {
          error:
            "This payment was already used or the verification expired.",
        },
        {
          status: 409,
        }
      );
    }

    return NextResponse.json({
      ok: true,

      verified: true,

      walletAddress:
        challenge.wallet_address,

      message:
        challenge.message,

      holderBalance:
        holder.balance,

      transactionSignature:
        transfer.signature,

      verifiedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "[holder-verification-complete]",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to verify payment.",
      },
      {
        status: 500,
      }
    );
  }
}
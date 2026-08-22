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
  getCurrentTopHolder,
  getVerificationWallet,
  looksLikeSolanaAddress,
  normalizeHolderMessage,
  VERIFICATION_AMOUNT_LAMPORTS,
  VERIFICATION_AMOUNT_SOL,
  VERIFICATION_LIFETIME_MS,
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

    const walletAddress =
      typeof body?.walletAddress ===
      "string"
        ? body.walletAddress.trim()
        : "";

    const message =
      normalizeHolderMessage(
        body?.message
      );

    if (
      !looksLikeSolanaAddress(
        walletAddress
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Enter a valid Solana holder address.",
        },
        {
          status: 400,
        }
      );
    }

    if (!message) {
      return NextResponse.json(
        {
          error:
            "Enter a message.",
        },
        {
          status: 400,
        }
      );
    }

    const holder =
      await getCurrentTopHolder(
        walletAddress
      );

    if (!holder) {
      return NextResponse.json(
        {
          error:
            "That wallet is not currently one of the displayed top holders.",
        },
        {
          status: 403,
        }
      );
    }

    const destinationWallet =
      getVerificationWallet();

    const expiresAt =
      new Date(
        Date.now() +
          VERIFICATION_LIFETIME_MS
      ).toISOString();

    const {
      data:
        challenge,
      error,
    } =
      await supabaseAdmin
        .from(
          "holder_verification_challenges"
        )
        .insert({
          mint:
            TOKEN_MINT,

          wallet_address:
            walletAddress,

          message,

          destination_wallet:
            destinationWallet,

          amount_lamports:
            VERIFICATION_AMOUNT_LAMPORTS,

          expires_at:
            expiresAt,
        })
        .select(
          `
            id,
            created_at
          `
        )
        .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      challengeId:
        challenge.id,

      walletAddress,

      destinationWallet,

      amountSol:
        VERIFICATION_AMOUNT_SOL,

      amountLamports:
        VERIFICATION_AMOUNT_LAMPORTS,

      message,

      balance:
        holder.balance,

      createdAt:
        challenge.created_at,

      expiresAt,
    });
  } catch (error) {
    console.error(
      "[holder-verification-challenge]",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to start verification.",
      },
      {
        status: 500,
      }
    );
  }
}
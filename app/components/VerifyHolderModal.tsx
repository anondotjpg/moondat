"use client";

import {
  useState,
} from "react";

type ChallengeResponse = {
  challengeId: string;

  walletAddress: string;
  destinationWallet: string;

  amountSol: number;
  amountLamports: number;

  message: string;
  balance: number;

  createdAt: string;
  expiresAt: string;
};

type VerifyHolderModalProps = {
  open: boolean;

  onClose: () => void;

  onVerified?: (
    result: {
      address: string;
      message: string;
    }
  ) => void | Promise<void>;
};

function shorten(
  address: string
) {
  if (
    address.length <
    12
  ) {
    return address;
  }

  return `${address.slice(
    0,
    5
  )}…${address.slice(-5)}`;
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
      />

      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export default function VerifyHolderModal({
  open,
  onClose,
  onVerified,
}: VerifyHolderModalProps) {
  const [
    walletAddress,
    setWalletAddress,
  ] =
    useState("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    challenge,
    setChallenge,
  ] =
    useState<ChallengeResponse | null>(
      null
    );

  const [
    creating,
    setCreating,
  ] =
    useState(false);

  const [
    checking,
    setChecking,
  ] =
    useState(false);

  const [
    verified,
    setVerified,
  ] =
    useState(false);

  const [
    copied,
    setCopied,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null
    );

  if (!open) {
    return null;
  }

  function reset() {
    setWalletAddress(
      ""
    );

    setMessage(
      ""
    );

    setChallenge(
      null
    );

    setCreating(
      false
    );

    setChecking(
      false
    );

    setVerified(
      false
    );

    setCopied(
      false
    );

    setError(
      null
    );
  }

  function close() {
    reset();
    onClose();
  }

  async function createChallenge() {
    try {
      setCreating(
        true
      );

      setError(
        null
      );

      const response =
        await fetch(
          "/api/verify-holder/challenge",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                walletAddress:
                  walletAddress.trim(),

                message:
                  message.trim(),
              }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ??
            "Unable to start verification."
        );
      }

      setChallenge(
        data as ChallengeResponse
      );
    } catch (err) {
      setError(
        err instanceof
          Error
          ? err.message
          : "Unable to start verification."
      );
    } finally {
      setCreating(
        false
      );
    }
  }

  async function checkPayment() {
    if (
      !challenge
    ) {
      return;
    }

    try {
      setChecking(
        true
      );

      setError(
        null
      );

      const response =
        await fetch(
          "/api/verify-holder/complete",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                challengeId:
                  challenge.challengeId,
              }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ??
            "Payment not found."
        );
      }

      setVerified(
        true
      );

      await onVerified?.({
        address:
          challenge.walletAddress,

        message:
          challenge.message,
      });
    } catch (err) {
      setError(
        err instanceof
          Error
          ? err.message
          : "Unable to verify payment."
      );
    } finally {
      setChecking(
        false
      );
    }
  }

  async function copyDestination() {
    if (
      !challenge
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        challenge.destinationWallet
      );

      setCopied(
        true
      );

      window.setTimeout(
        () => {
          setCopied(
            false
          );
        },
        1400
      );
    } catch {
      setError(
        "Unable to copy address."
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          close();
        }
      }}
    >
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#090909] p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">
              Verify holder
            </h2>

            <p className="mt-1 text-xs leading-5 text-white/40">
              Prove ownership of
              a top wallet and
              leave a message on
              the moon.
            </p>
          </div>

          <button
            type="button"
            onClick={
              close
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {verified &&
        challenge ? (
          <div className="mt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black">
              <CheckIcon />
            </div>

            <div className="mt-4 text-base">
              Holder verified
            </div>

            <div className="mt-1 text-xs text-white/40">
              {shorten(
                challenge.walletAddress
              )}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-5 text-white/70">
              “
              {
                challenge.message
              }
              ”
            </div>

            <button
              type="button"
              onClick={
                close
              }
              className="mt-5 h-11 w-full rounded-xl bg-white text-sm font-medium text-black transition hover:bg-white/90"
            >
              Done
            </button>
          </div>
        ) : challenge ? (
          <div className="mt-6">
            <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                Send exactly
              </div>

              <div className="mt-1 text-2xl font-medium">
                0.01 SOL
              </div>

              <div className="mt-5 text-[10px] uppercase tracking-[0.14em] text-white/30">
                From
              </div>

              <div className="mt-1 break-all text-xs text-white/65">
                {
                  challenge.walletAddress
                }
              </div>

              <div className="mt-5 text-[10px] uppercase tracking-[0.14em] text-white/30">
                To
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="min-w-0 flex-1 break-all text-xs leading-5 text-white/65">
                  {
                    challenge.destinationWallet
                  }
                </div>

                <button
                  type="button"
                  onClick={
                    copyDestination
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/45 transition hover:bg-white/[0.05] hover:text-white"
                  aria-label="Copy verification address"
                >
                  {copied ? (
                    <CheckIcon />
                  ) : (
                    <CopyIcon />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-white/40">
              The transfer must
              come directly from
              the holder address
              above. The 0.01 SOL
              is an actual
              transfer, not a
              network fee.
            </div>

            {error && (
              <div className="mt-3 text-xs leading-5 text-red-400">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={
                checking
              }
              onClick={
                checkPayment
              }
              className="mt-5 h-11 w-full rounded-xl bg-white text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking
                ? "Checking chain..."
                : "I've sent 0.01 SOL"}
            </button>

            <button
              type="button"
              disabled={
                checking
              }
              onClick={() => {
                setChallenge(
                  null
                );

                setError(
                  null
                );
              }}
              className="mt-2 h-10 w-full text-xs text-white/35 transition hover:text-white/60"
            >
              Back
            </button>

            <p className="mt-2 text-center text-[10px] leading-4 text-white/25">
              Verification expires
              15 minutes after it
              is created.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                Holder address
              </div>

              <input
                value={
                  walletAddress
                }
                onChange={(
                  event
                ) => {
                  setWalletAddress(
                    event.target
                      .value
                  );

                  setError(
                    null
                  );
                }}
                placeholder="Solana wallet address"
                spellCheck={false}
                autoComplete="off"
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-white/20"
              />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/30">
                  Message
                </div>

                <div className="text-[10px] text-white/25">
                  {
                    message.length
                  }
                  /120
                </div>
              </div>

              <textarea
                value={
                  message
                }
                maxLength={
                  120
                }
                onChange={(
                  event
                ) => {
                  setMessage(
                    event.target
                      .value
                  );

                  setError(
                    null
                  );
                }}
                placeholder="still not selling..."
                className="mt-2 min-h-[96px] w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-white/20"
              />
            </div>

            {error && (
              <div className="mt-3 text-xs leading-5 text-red-400">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={
                creating ||
                !walletAddress.trim() ||
                !message.trim()
              }
              onClick={
                createChallenge
              }
              className="mt-5 h-11 w-full rounded-xl bg-white text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {creating
                ? "Checking holder..."
                : "Continue"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
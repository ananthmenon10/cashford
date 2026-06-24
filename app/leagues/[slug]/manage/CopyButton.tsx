"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label,
  variant = "primary",
}: {
  text: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const base = "w-full rounded-control py-2.5 text-[14px] font-bold";
  const cls =
    variant === "primary"
      ? `${base} bg-primary text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]`
      : `${base} border border-border bg-subtle text-fg font-semibold`;

  return (
    <button type="button" onClick={handleCopy} className={cls}>
      {copied ? "Copied!" : label}
    </button>
  );
}

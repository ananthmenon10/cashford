"use client";

// Share ladder for a locked bracket. Web Share sends the /b/<token> URL (unfurls to
// the OG image everywhere); Save downloads that same server-rendered PNG; Copy + a
// WhatsApp deep-link cover desktop. Instagram has no web pre-attach — say so honestly.

import { useEffect, useState } from "react";

export function KnockoutShare({ shareToken, championName, accuracy }: { shareToken: string; championName: string; accuracy: string }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  // Start relative so SSR and the first client render agree (no hydration mismatch),
  // then upgrade to the absolute URL after mount.
  const [url, setUrl] = useState(`/b/${shareToken}`);
  const [canShare, setCanShare] = useState(false); // client-only; false on SSR/first render (no mismatch)
  useEffect(() => {
    setUrl(`${window.location.origin}/b/${shareToken}`);
    setCanShare(!!navigator.share);
  }, [shareToken]);
  const text = `My World Cup 2026 bracket: ${championName} to win.${accuracy ? ` ${accuracy}.` : ""} Think you can beat me?`;

  const webShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: "My Cashford Bracket", text, url });
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") console.error("share failed", e);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/b/${shareToken}/opengraph-image`);
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = "my-cashford-bracket.png";
      a.click();
      URL.revokeObjectURL(u);
    } finally {
      setSaving(false);
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {canShare && (
        <button onClick={webShare} className="w-full rounded-[9px] py-2.5 text-[13px] font-extrabold text-white" style={{ background: "#15A66A", boxShadow: "0 4px 14px rgba(21,166,106,.4)" }}>
          Share bracket →
        </button>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 rounded-[9px] border py-2.5 text-[12px] font-bold" style={{ borderColor: "rgba(255,255,255,.1)", color: "#E7ECEF" }}>
          {saving ? "Saving…" : "Save image"}
        </button>
        <button onClick={copy} className="flex-1 rounded-[9px] border py-2.5 text-[12px] font-bold" style={{ borderColor: "rgba(255,255,255,.1)", color: "#E7ECEF" }}>
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-[9px] border py-2.5 text-center text-[12px] font-bold" style={{ borderColor: "rgba(255,255,255,.1)", color: "#E7ECEF" }}>
          WhatsApp
        </a>
      </div>
      <p className="text-center text-[10px]" style={{ color: "#7a8794" }}>Instagram: save the image, then post it from your camera roll.</p>
    </div>
  );
}

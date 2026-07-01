import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { createServiceRoleClient } from "@/lib/supabase/service";

// Link-preview image for a shared bracket. Satori can't render our inline SVG bracket,
// so this is a branded CHAMPION CARD (flex-only, Satori-safe). Node runtime (font fetch);
// revalidate 300 — picks are frozen post-lock, only the score overlay evolves.
export const runtime = "nodejs";
export const revalidate = 300;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "My World Cup 2026 Knockout Bracket · Cashford";

const TOURNAMENT = "wc2026";
const ALLOWED_FLAG_ORIGIN = "https://a.espncdn.com";

// Bundled Hanken Grotesk 800 TTF (Satori needs truetype/opentype). Loaded once at
// module scope from /public — no runtime network dependency.
const fontPromise = readFile(join(process.cwd(), "public/fonts/hanken-800.ttf"));

function safeFlag(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin === ALLOWED_FLAG_ORIGIN ? url : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createServiceRoleClient();

  const { data: b } = await admin
    .from("knockout_brackets")
    .select("champion_team_id, correct_picks, total_decided, user_id")
    .eq("share_token", id)
    .not("locked_at", "is", null) // only LOCKED brackets are shareable
    .maybeSingle();

  let champName = "";
  let champCode = "?";
  let flag: string | null = null;
  let owner = "";
  if (b?.champion_team_id) {
    const { data: t } = await admin.from("teams").select("name, short_name, flag_url").eq("id", b.champion_team_id).maybeSingle();
    champName = (t?.name as string) ?? "";
    champCode = (t?.short_name as string) ?? "?";
    flag = safeFlag(t?.flag_url as string);
  }
  if (b?.user_id) {
    const { data: p } = await admin.from("profiles").select("username").eq("id", b.user_id).maybeSingle();
    owner = (p?.username as string) ?? "";
  }
  const acc = b && (b.total_decided as number) > 0 ? `${b.correct_picks}/${b.total_decided} correct` : "";
  const font = await fontPromise;

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#0B0F14", alignItems: "center", justifyContent: "center", padding: "56px 72px", position: "relative" }}>
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0, right: 0, height: 6, background: "linear-gradient(90deg,#15A66A,#F2C94C)" }} />
        <div style={{ display: "flex", color: "#15A66A", fontSize: 22, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase" }}>My World Cup 2026 Bracket</div>
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 40 }}>
          {flag ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flag} width={128} height={128} style={{ borderRadius: 64, objectFit: "cover" }} alt="" />
          ) : (
            <div style={{ display: "flex", width: 128, height: 128, borderRadius: 64, background: "#15A66A", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 800, color: "#fff" }}>{champCode}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", color: "#F2C94C", fontSize: 20, fontWeight: 800, letterSpacing: 3 }}>MY CHAMPION</div>
            <div style={{ display: "flex", color: "#F2F2F2", fontSize: 84, fontWeight: 800, lineHeight: 1 }}>{champName || "Champion"}</div>
          </div>
        </div>
        {acc && <div style={{ display: "flex", marginTop: 34, color: "#22C55E", fontSize: 30, fontWeight: 800 }}>{acc}</div>}
        <div style={{ display: "flex", position: "absolute", bottom: 44, color: "#6B7280", fontSize: 22, fontWeight: 800 }}>
          {owner ? `${owner} · ` : ""}Think you can beat me? · cashford.vercel.app
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Hanken Grotesk",
          data: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer,
          weight: 800 as const,
          style: "normal" as const,
        },
      ],
    },
  );
}

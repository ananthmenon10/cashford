import { ImageResponse } from "next/og";

// iOS home-screen icon (Apple ignores the web manifest for this). 180×180.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center", background: "#15A66A",
        }}
      >
        <div style={{ width: 72, height: 72, borderRadius: 9999, background: "#F2C94C" }} />
      </div>
    ),
    size,
  );
}

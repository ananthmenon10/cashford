import { ImageResponse } from "next/og";

// Placeholder app icon (green tile + gold dot, matching the in-app mark).
// Used for favicon + Android manifest. Replace with the real logo when ready.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center", background: "#15A66A",
        }}
      >
        <div style={{ width: 200, height: 200, borderRadius: 9999, background: "#F2C94C" }} />
      </div>
    ),
    size,
  );
}

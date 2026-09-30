/**
 * Clandar's mark (brand/clandar-logo-v2/svg/mark-light.svg): a heavy C — a ring segment open ±42°
 * on the right, ends cut along the radius — wrapping a dot, shifted slightly right so the open C
 * sits optically centred. Ink C and green dot on light backgrounds (`light`, the website's logo),
 * white C and lime dot on dark ones (`dark`). Drawn inline so it's crisp at any size.
 */
const C_PATH =
  "M49.599 17.279A22 22 0 1 0 49.599 46.721L41.796 39.695A11.5 11.5 0 1 1 41.796 24.305Z";

/** The mark's own bounds (C from x 11.25 to its tips at 49.6, y 10–54) — no empty margin around it. */
const VIEW = { x: 11.25, y: 10, w: 38.35, h: 44 };

export function BrandMark({
  size = 32,
  variant = "light",
  className = "",
}: {
  /** The mark's height in pixels. */
  size?: number;
  variant?: "light" | "dark";
  className?: string;
}) {
  const dark = variant === "dark";
  // Whole-pixel box: fractional sizes smear every edge across two pixels. The width is rounded up
  // and the viewBox widened (centred) to match, so the mark keeps its exact proportions.
  const height = Math.round(size);
  const width = Math.ceil((height * VIEW.w) / VIEW.h);
  const vbW = (VIEW.h * width) / height;
  const vbX = VIEW.x - (vbW - VIEW.w) / 2;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`${vbX.toFixed(3)} ${VIEW.y} ${vbW.toFixed(3)} ${VIEW.h}`}
      shapeRendering="geometricPrecision"
      role="img"
      aria-label="Clandar"
      className={`shrink-0 ${className}`}
    >
      <path d={C_PATH} fill={dark ? "#ffffff" : "#101211"} />
      <circle cx="33.25" cy="32" r="6.5" fill={dark ? "#d7f56b" : "#8dc63f"} />
    </svg>
  );
}

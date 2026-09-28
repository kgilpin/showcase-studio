/* Where TikTok draws its own interface over the video — shown over the
 * TikTok view when the player's "Safe area" switch is on, never in an
 * export. Measured on an iPhone in the TikTok app, where the 9:16 frame
 * fills the screen above TikTok's tab bar:
 *
 *   +--+--------------------------+--+
 *   |  |  tabs, search      0-13%  |  |
 *   |  |                           |  |
 *   |  |                    +------+  |  buttons: 84-100% across,
 *   |  |                    | like |  |  43-75% down
 *   |  |                    | share|  |
 *   |  +--------------------+------+  |
 *   |  |  username, description,   |  |
 *   |  |  sound           75-100%  |  |
 *   +--+--------------------------+--+
 *    ^ a tall phone cuts ~5% off each side
 *
 * The heights match the caption presets in SceneView.tsx: "top" starts
 * where the tabs end, "bottom" ends where the description begins. */

const ZONES = [
  { label: "Tabs and search", style: { top: 0, left: 0, right: 0, height: "13%" } },
  {
    label: "Username, description, sound",
    style: { bottom: 0, left: 0, right: 0, height: "25%" },
  },
  { label: "Buttons", style: { top: "43%", right: 0, width: "16%", height: "32%" } },
] as const;

export function TikTokSafeArea() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 @container">
      {ZONES.map((zone) => (
        <div
          key={zone.label}
          className="absolute flex items-center justify-center border border-dashed border-amber-300/70 bg-amber-400/25"
          style={zone.style}
        >
          <span className="rounded bg-black/60 px-[1.5cqw] py-[0.5cqw] text-center text-[3cqw] leading-tight text-amber-100">
            {zone.label}
          </span>
        </div>
      ))}
      {/* The sides a tall phone crops (the frame is wider than the space
       * above the tab bar there). */}
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          className="absolute inset-y-0 w-[5%] bg-[repeating-linear-gradient(45deg,rgba(251,191,36,0.3)_0_4px,transparent_4px_10px)]"
          style={{ [side]: 0 }}
          title="Cut off on tall phones"
        />
      ))}
    </div>
  );
}

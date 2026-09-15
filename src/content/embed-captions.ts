/* EMBED CAPTIONS — whether the 4:3 embed canvas (the YouTube/desktop
 * rendition and its video-43 exports) lays captions over the media.
 *
 * `meta.embedCaptions` in showcase.yaml decides when it is set. When it is
 * not, the default follows the soundtrack: a showcase with a voiceover
 * (`soundtrack.sync: true` with a src) is already narrated, so the embed
 * hides its overlay captions; one without shows them, since they are the
 * only way the narration reaches the viewer.
 *
 * The player's 4:3 captions toggle writes the key only when the user picks
 * a value, and clears it to return to the default — so adding a voiceover
 * later still hides captions unless someone chose otherwise. */

type SoundtrackLike = { src?: string; sync?: boolean } | undefined;

/** A soundtrack locked to the scene timeline that has something to play. */
export function hasVoiceover(soundtrack: SoundtrackLike): boolean {
  return soundtrack?.sync === true && !!soundtrack.src;
}

/** Whether the embed canvas shows overlay captions, and whether that comes
 *  from the default (`auto`) or from showcase.yaml. */
export function embedCaptionsSetting(meta: {
  embedCaptions?: boolean | undefined;
  soundtrack?: SoundtrackLike;
}): { shown: boolean; auto: boolean } {
  if (typeof meta.embedCaptions === "boolean") return { shown: meta.embedCaptions, auto: false };
  return { shown: !hasVoiceover(meta.soundtrack), auto: true };
}

// Pinterest account/board IDs (via Buffer). Self-contained so this lane doesn't depend on the video lane.
export const BUFFER = {
  api: "https://api.buffer.com",
  org: "6a49d35807bd7d95012164e6",
  pinterest: "6a49d52740483446286f7157", // channel: thescreenreportnews
  // boardServiceId = Pinterest's NATIVE board id (serviceId), not Buffer's internal id
  boards: {
    movies: "1090786040939353827",     // Movie News
    tv: "1090786040939353829",         // TV News
    celebrity: "1090786040939353832",  // Celebrity
  },
};

// route an article category → the pin's board (fallback → Movie News)
export function boardFor(category = "") {
  const c = String(category).toLowerCase();
  if (["tv", "series", "television"].includes(c)) return BUFFER.boards.tv;
  if (["celebrity", "celebrities", "gossip", "music"].includes(c)) return BUFFER.boards.celebrity;
  return BUFFER.boards.movies;
}

// Verified account/channel/board IDs for the social bridges (captured + live-verified 2026-07-05).
// Zernio bridges Facebook + Instagram; Buffer bridges YouTube + Pinterest. Keys live in the parent .env.
export const ZERNIO = {
  api: "https://zernio.com/api/v1",
  facebook: "6a49d30b9d9472faae7e1258", // Page: The Screen Report
  instagram: "6a49d2b69d9472faae7e109f", // IG business: thescreenreportnews
};

export const BUFFER = {
  api: "https://api.buffer.com",
  org: "6a49d35807bd7d95012164e6",
  youtube: "6a49d51440483446286f712e", // channel: The Screen Report
  pinterest: "6a49d52740483446286f7157", // board owner: thescreenreportnews
  // Pinterest board routing by article category → the pin's board.
  // NOTE: boardServiceId wants Pinterest's NATIVE board id (serviceId), not Buffer's internal id.
  boards: {
    movies: "1090786040939353827", // Movie News
    tv: "1090786040939353829", // TV News
    celebrity: "1090786040939353832", // Celebrity
  },
};

// map any article category to a Pinterest board (fallback → Movie News)
export function boardFor(category = "") {
  const c = String(category).toLowerCase();
  if (c === "tv" || c === "series" || c === "television") return BUFFER.boards.tv;
  if (c === "celebrity" || c === "celebrities" || c === "gossip" || c === "music") return BUFFER.boards.celebrity;
  return BUFFER.boards.movies;
}

// Client-safe (Web Crypto works in browsers and Node).

// No look-alike characters (0/O, 1/l/I) so it can be read out over the phone.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. "k7Qm-x9Tb-P3wz" (~70 bits). Modulo bias over 2^32 is negligible for 55 symbols. */
export function tempPassword() {
  const n = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(n, (v) => ALPHABET[v % ALPHABET.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

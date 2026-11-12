// Eigene RegioTipp-Vereinsabzeichen: Schild in Vereinsfarben mit Kürzel (z.B. "FCW").
// Kein Nachbau der Original-Wappen – nur Farben und Initialen werden übernommen.

const PREFIXES = new Set(["fc", "sc", "sv", "fcb", "us", "ac", "bc", "cs", "ffc", "fv", "sk", "sk", "sp", "vfc", "vfb", "ad", "cd", "sd", "ud", "ks", "nk", "ss", "asd", "afc", "fk", "gc"]);
const SMALL = new Set(["de", "da", "do", "la", "le", "les", "del", "della", "di", "von", "vom", "am", "an", "im", "und", "&", "e", "y", "et", "a/a", "a/a.", "zh"]);
const CITY = new Set(["zürich", "zurich", "zurigo", "zurique", "zh"]);

// "FC Witikon 1", "FC Witikon a", "FC Bülach b*" -> "FC Witikon", "FC Bülach"
export function clubName(teamNames: string[]): string {
  const strip = (n: string) => {
    const words = n.replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
    while (words.length > 1 && /^(\d+|[a-z]\*?|\*|frauen|damen|women|ii|iii|iv|[a-e][a-e]?\*?)$/i.test(words[words.length - 1])) words.pop();
    return words.join(" ");
  };
  const counts = new Map<string, number>();
  for (const n of teamNames) { const c = strip(n); counts.set(c, (counts.get(c) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? teamNames[0] ?? "?";
}

// "FC Witikon" -> "FCW", "FC Wettswil-Bonstetten" -> "FCWB", "Benfica Clube de Zurique" -> "BCZ"
export function initials(club: string): string {
  const words = club.replace(/[()"'.,]/g, " ").split(/\s+/).filter(Boolean);
  let prefix = "";
  const rest: string[] = [];
  words.forEach((w, i) => {
    if (i === 0 && PREFIXES.has(w.toLowerCase())) prefix = w.toUpperCase();
    else if (i === 0 && /^[A-ZÄÖÜ]{2,4}$/.test(w)) prefix = w;
    else if (!SMALL.has(w.toLowerCase())) rest.push(...w.split(/[-\/]/).filter(Boolean));
  });
  // Ortszusatz "Zürich"/"ZH" am Ende weglassen, wenn sonst noch etwas übrig bleibt
  while (rest.length > 1 && CITY.has(rest[rest.length - 1].toLowerCase())) rest.pop();
  let letters = rest.map((w) => w[0].toUpperCase()).join("");
  if (!prefix && letters.length === 1) letters = rest[0].slice(0, 3).toUpperCase();
  return (prefix + letters).slice(0, 4) || "?";
}

// Hauptfarben aus RGBA-Pixeln: Weiss/Transparent ignorieren, ähnliche Farben bündeln
export function palette(rgba: Uint8ClampedArray | Uint8Array): [string, string] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (a < 128) continue;
    if (r > 225 && g > 225 && b > 225) continue; // weisser Hintergrund
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const cols = [...buckets.values()].sort((x, y) => y.n - x.n)
    .map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] as [number, number, number]);
  const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
  // Bunte Farben bevorzugen, Schwarz/Grau nur, wenn nichts Buntes da ist
  const colorful = cols.filter((c) => sat(c) > 60);
  const first = colorful[0] ?? cols[0] ?? [11, 110, 79];
  let second = cols.find((c) => dist(c, first) > 120) ?? [255, 255, 255];
  // Mittelgrau ist meist Kantenglättung zu Weiss -> Weiss verwenden
  const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  if (sat(second) < 40 && lum(second) > 70 && lum(second) < 215) second = [255, 255, 255];
  const hex = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  return [hex(first), hex(second)];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const escXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

export function badgeSvg(text: string, c1: string, c2: string): string {
  const fg = luminance(c1) > 0.45 ? "#111111" : "#ffffff";
  const accent = Math.abs(luminance(c2) - luminance(c1)) < 0.08 ? fg : c2;
  const n = text.length;
  const size = n <= 2 ? 34 : n === 3 ? 27 : 21;
  const fit = n >= 3 ? ` textLength="${n === 3 ? 52 : 58}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">
  <path d="M50 4 L90 15 V47 C90 72 73 88 50 96 C27 88 10 72 10 47 V15 Z" fill="${accent}" stroke="rgba(0,0,0,.28)" stroke-width="1.5"/>
  <path d="M50 11 L83 20 V47 C83 67 69 81 50 88 C31 81 17 67 17 47 V20 Z" fill="${c1}"/>
  <path d="M17 62 H83 C81 66 79 70 76 73 H24 C21 70 19 66 17 62 Z" fill="${accent}"/>
  <text x="50" y="46" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${size}"${fit} fill="${fg}">${escXml(text)}</text>
</svg>`;
}

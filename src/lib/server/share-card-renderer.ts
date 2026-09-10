import sharp from "sharp";
import type { HogAppearance } from "../../components/hog/appearance.ts";

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export type ShareCardRenderInput = {
  appearance: HogAppearance;
  mutationName: string;
  speech: string;
};

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(value: string, limit = 34): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (!line || `${line} ${word}`.length <= limit) {
      line = line ? `${line} ${word}` : word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function eyes(appearance: HogAppearance): string {
  if (appearance.eyes === "wet") {
    return `<ellipse cx="267" cy="278" rx="31" ry="37" fill="#fff8fb" stroke="#743551" stroke-width="5"/>
      <ellipse cx="433" cy="278" rx="31" ry="37" fill="#fff8fb" stroke="#743551" stroke-width="5"/>
      <circle cx="267" cy="286" r="14" fill="#5931a4"/><circle cx="433" cy="286" r="14" fill="#5931a4"/>
      <circle cx="257" cy="268" r="7" fill="#fff"/><circle cx="423" cy="268" r="7" fill="#fff"/>`;
  }
  if (appearance.eyes === "cursor") {
    return `<rect x="242" y="272" width="42" height="12" rx="4" fill="#342139"/>
      <rect x="420" y="257" width="11" height="36" rx="3" fill="#342139"/>`;
  }
  if (appearance.eyes === "judging") {
    return `<path d="M235 269q31-19 61 2M404 271q31-21 61-2" fill="none" stroke="#5d293f" stroke-width="7" stroke-linecap="round"/>
      <circle cx="272" cy="282" r="7" fill="#41202e"/><circle cx="428" cy="282" r="7" fill="#41202e"/>`;
  }
  if (appearance.eyes === "shades") {
    return `<path d="M222 258l92 8-8 50q-76 12-84-58ZM478 258l-92 8 8 50q76 12 84-58Z" fill="#1e1520" stroke="#0c090d" stroke-width="6"/>
      <path d="M308 274q42-13 84 0" fill="none" stroke="#0c090d" stroke-width="6"/>`;
  }
  return `<circle cx="267" cy="278" r="10" fill="#442033"/><circle cx="433" cy="278" r="10" fill="#442033"/>`;
}

function extras(appearance: HogAppearance): string {
  const parts: string[] = [];
  if (appearance.back === "keyboard") {
    parts.push(`<path d="M220 222l24-83h212l24 83Z" fill="#28252c" stroke="#121016" stroke-width="7"/>
      <path d="M266 163h164M258 184h180M250 205h198" stroke="#a9ffce" stroke-width="8" stroke-dasharray="20 10"/>`);
  }
  if (appearance.outfit === "blazer") {
    parts.push(`<path d="M183 326q24 144 167 151 143-7 167-151v125q-78 45-167 45t-167-45Z" fill="#355770" stroke="#183245" stroke-width="7"/>
      <path d="M301 333l49 60 49-60M339 392h22l12 68-23 21-23-21Z" fill="#df4d71" stroke="#183245" stroke-width="6"/>`);
  }
  if (appearance.outfit === "cap") {
    parts.push(`<path d="M234 233q90-105 207-13l-16 48q-93-38-188 2Z" fill="#7eec8d" stroke="#245a35" stroke-width="7"/>
      <path d="M414 249q67-8 97 18-63 17-101 3Z" fill="#7eec8d" stroke="#245a35" stroke-width="7"/>`);
  }
  if (appearance.effect === "sparkles") {
    parts.push(`<path d="M125 191l10 25 25 10-25 10-10 25-10-25-25-10 25-10ZM544 147l8 20 20 8-20 8-8 20-8-20-20-8 20-8Z" fill="#ffe870"/>`);
  }
  if (appearance.effect === "chat") {
    parts.push(`<path d="M495 166h108v80h-28l-22 22-2-22h-56Z" fill="#f2f1e8" stroke="#37303d" stroke-width="6"/>
      <path d="M515 190h67M515 211h49" stroke="#735881" stroke-width="6" stroke-linecap="round"/>`);
  }
  if (appearance.effect === "flies") {
    parts.push(`<path d="M133 279q20-27 38 0M527 222q20-27 38 0M536 405q20-27 38 0" fill="none" stroke="#252018" stroke-width="5"/>
      <circle cx="152" cy="279" r="6" fill="#252018"/><circle cx="546" cy="222" r="6" fill="#252018"/><circle cx="555" cy="405" r="6" fill="#252018"/>`);
  }
  return parts.join("");
}

function cardSvg(input: ShareCardRenderInput): string {
  const lines = wrapText(input.speech);
  const bodyRx = { small: 150, round: 171, huge: 196, lean: 122 }[input.appearance.body];
  const bodyRy = { small: 119, round: 133, huge: 151, lean: 136 }[input.appearance.body];
  const mouth = input.appearance.mouth === "flat"
    ? "M316 352h68"
    : input.appearance.mouth === "grin"
      ? "M301 340q49 54 98 0"
      : "M316 341q34 33 68 0";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 1200 630">
    <defs><radialGradient id="bg"><stop stop-color="#5b304b"/><stop offset="1" stop-color="#171117"/></radialGradient>
      <radialGradient id="pig" cx="38%" cy="28%" r="75%"><stop stop-color="#ffc9dc"/><stop offset="1" stop-color="#e887ad"/></radialGradient></defs>
    <rect width="1200" height="630" fill="url(#bg)"/><rect x="38" y="38" width="1124" height="554" rx="34" fill="none" stroke="#8b5a72" stroke-width="2"/>
    <text x="705" y="107" fill="#ff8fba" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="5">SLOP HOGS</text>
    <text x="705" y="151" fill="#fff4f8" font-family="Arial, sans-serif" font-size="30" font-weight="700">${xml(input.mutationName)} UNLOCKED</text>
    ${lines.map((line, index) => `<text x="705" y="${222 + index * 58}" fill="#fff4f8" font-family="Arial, sans-serif" font-size="39" font-weight="700">${xml(line)}</text>`).join("")}
    <text x="705" y="544" fill="#c9b5c0" font-family="Arial, sans-serif" font-size="23">${xml(input.appearance.name)}</text>
    <ellipse cx="350" cy="498" rx="190" ry="23" fill="#080508" opacity=".45"/>
    ${extras(input.appearance)}
    <path d="M${350 - bodyRx + 15} 309q-34-120-72-61l20 73M${350 + bodyRx - 15} 309q34-120 72-61l-20 73" fill="#ea91b2" stroke="#7a3553" stroke-width="8"/>
    <ellipse cx="350" cy="355" rx="${bodyRx}" ry="${bodyRy}" fill="url(#pig)" stroke="#7a3553" stroke-width="8"/>
    ${eyes(input.appearance)}
    <ellipse cx="350" cy="332" rx="67" ry="48" fill="#ffb1cc" stroke="#9e496c" stroke-width="6"/>
    <ellipse cx="325" cy="324" rx="8" ry="12" fill="#72314e"/><ellipse cx="375" cy="324" rx="8" ry="12" fill="#72314e"/>
    <path d="${mouth}" fill="${input.appearance.mouth === "grin" ? "#fff8ee" : "none"}" stroke="#5f2740" stroke-width="7" stroke-linecap="round"/>
  </svg>`;
}

export async function renderShareCardPng(
  input: ShareCardRenderInput,
  timeoutMs: number,
): Promise<Buffer> {
  const image = sharp(Buffer.from(cardSvg(input)))
    .timeout({ seconds: Math.max(1, Math.ceil(timeoutMs / 1_000)) })
    .png({ compressionLevel: 9, palette: true, quality: 90 });
  return image.toBuffer();
}

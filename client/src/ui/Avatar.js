// Generates a small, original SVG avatar from a compact config. No external
// image assets — keeps the cosmetic system lightweight per spec (§14).

const SKIN_COLORS = ["#ffd9b3", "#f1c27d", "#c68642", "#8d5524", "#ffe4c4"];
const HAIR_COLORS = ["#2b2d42", "#8d5524", "#e8b923", "#c0392b", "#6c5ce7"];
const BG_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd166", "#a29bfe", "#55efc4", "#fd79a8"];
const HAIR_STYLES = ["short", "bald", "spiky", "bun", "curly"];
const ACCESSORIES = ["none", "glasses", "cap", "bow", "star"];

export function randomAvatar() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return {
    bg: pick(BG_COLORS),
    skin: pick(SKIN_COLORS),
    hair: pick(HAIR_COLORS),
    hairStyle: pick(HAIR_STYLES),
    accessory: pick(ACCESSORIES),
  };
}

export function avatarToSvg(avatar, size = 40) {
  const { bg, skin, hair, hairStyle, accessory } = avatar;
  let hairShape = "";
  if (hairStyle === "short") hairShape = `<path d="M8 16 Q20 2 32 16 L32 20 L8 20 Z" fill="${hair}"/>`;
  if (hairStyle === "spiky") hairShape = `<path d="M6 18 L12 4 L16 16 L20 2 L24 16 L28 4 L34 18 Z" fill="${hair}"/>`;
  if (hairStyle === "bun") hairShape = `<circle cx="20" cy="6" r="4" fill="${hair}"/><path d="M8 16 Q20 6 32 16 L32 18 L8 18 Z" fill="${hair}"/>`;
  if (hairStyle === "curly") hairShape = `<circle cx="12" cy="12" r="5" fill="${hair}"/><circle cx="20" cy="8" r="6" fill="${hair}"/><circle cx="28" cy="12" r="5" fill="${hair}"/>`;

  let accessoryShape = "";
  if (accessory === "glasses") accessoryShape = `<rect x="10" y="19" width="8" height="6" rx="2" fill="none" stroke="#2b2d42" stroke-width="1.5"/><rect x="22" y="19" width="8" height="6" rx="2" fill="none" stroke="#2b2d42" stroke-width="1.5"/><line x1="18" y1="22" x2="22" y2="22" stroke="#2b2d42" stroke-width="1.5"/>`;
  if (accessory === "cap") accessoryShape = `<path d="M6 15 Q20 0 34 15 L34 13 Q20 -2 6 13 Z" fill="#ff6b6b"/>`;
  if (accessory === "bow") accessoryShape = `<path d="M14 6 L20 10 L14 14 Z M26 6 L20 10 L26 14 Z" fill="#e84393"/>`;
  if (accessory === "star") accessoryShape = `<text x="30" y="12" font-size="10">⭐</text>`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}">
    <circle cx="20" cy="20" r="20" fill="${bg}"/>
    <circle cx="20" cy="22" r="12" fill="${skin}"/>
    <circle cx="15" cy="21" r="1.5" fill="#2b2d42"/>
    <circle cx="25" cy="21" r="1.5" fill="#2b2d42"/>
    <path d="M15 27 Q20 30 25 27" stroke="#2b2d42" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    ${hairShape}
    ${accessoryShape}
  </svg>`;
}

export { SKIN_COLORS, HAIR_COLORS, BG_COLORS, HAIR_STYLES, ACCESSORIES };

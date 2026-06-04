// ══════════════════════════════════════════════════════════════════
// src/components/theme.js
// Palette de couleurs et constantes de style partagées.
// Source unique pour la charte (bleu Les Cimes, verts, oranges…).
// ══════════════════════════════════════════════════════════════════

export const C = {
  blue: "#1B3A6B", blueL: "#2E5FAC", bluePale: "#EEF4FF",
  green: "#1A7A5E", greenL: "#E6F4EF",
  orange: "#D45400", orangeL: "#FFF0E6",
  red: "#B91C1C", redL: "#FEE2E2",
  purple: "#6D28D9", purpleL: "#EDE9FE",
  gold: "#92400E", goldL: "#FEF3C7",
  gray: "#6B7280", grayL: "#F3F4F6", grayM: "#E5E7EB",
  white: "#FFF", text: "#111827", textS: "#6B7280",
};

// Couleurs / libellés des catégories de saison
export const CAT_C = { haute: "#D45400", moyenne: C.blueL, basse: C.green };
export const CAT_L = { haute: "Haute saison", moyenne: "Moy. saison", basse: "Basse saison" };

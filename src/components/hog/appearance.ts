import {
  favoriteFood,
  type FoodKind,
  type GameState,
  type MutationId,
} from "../../lib/game.ts";

export const ART_VERSION = 1 as const;

export type HogAppearance = {
  artVersion: typeof ART_VERSION;
  variant: "base" | FoodKind;
  name: string;
  description: string;
  body: "small" | "round" | "huge" | "lean";
  eyes: "plain" | "wet" | "cursor" | "judging" | "shades";
  mouth: "smile" | "veneers" | "flat" | "grin";
  outfit: "none" | "blazer" | "cap";
  back: "none" | "keyboard";
  effect: "none" | "sparkles" | "chat" | "flies";
};

export const BASE_HOG: HogAppearance = {
  artVersion: ART_VERSION,
  variant: "base",
  name: "Fresh Hog",
  description: "A small pink pig with an open mind and an empty stomach.",
  body: "small",
  eyes: "plain",
  mouth: "smile",
  outfit: "none",
  back: "none",
  effect: "none",
};

export const DIET_APPEARANCES: Record<FoodKind, HogAppearance> = {
  ai_image: {
    artVersion: ART_VERSION,
    variant: "ai_image",
    name: "Prompt Baby",
    description: "An overfed hog with enormous wet eyes and an expensive-looking aura.",
    body: "huge",
    eyes: "wet",
    mouth: "smile",
    outfit: "none",
    back: "none",
    effect: "sparkles",
  },
  generated_post: {
    artVersion: ART_VERSION,
    variant: "generated_post",
    name: "Thought Leader",
    description: "A round hog in a tiny blazer, smiling through a full set of veneers.",
    body: "round",
    eyes: "plain",
    mouth: "veneers",
    outfit: "blazer",
    back: "none",
    effect: "none",
  },
  chatbot_screenshot: {
    artVersion: ART_VERSION,
    variant: "chatbot_screenshot",
    name: "Stack Overflowed",
    description: "A blinking hog with a mechanical keyboard growing out of its back.",
    body: "round",
    eyes: "cursor",
    mouth: "flat",
    outfit: "none",
    back: "keyboard",
    effect: "chat",
  },
  human_post: {
    artVersion: ART_VERSION,
    variant: "human_post",
    name: "Free Range",
    description: "Disturbingly lean, painfully alert, and quietly disappointed in you.",
    body: "lean",
    eyes: "judging",
    mouth: "flat",
    outfit: "none",
    back: "none",
    effect: "none",
  },
  shitpost: {
    artVersion: ART_VERSION,
    variant: "shitpost",
    name: "Mud Poster",
    description: "A filthy little celebrity thriving in conditions of its own creation.",
    body: "round",
    eyes: "shades",
    mouth: "grin",
    outfit: "cap",
    back: "none",
    effect: "flies",
  },
};

const MUTATION_APPEARANCE: Record<MutationId, Partial<HogAppearance>> = {
  glazed_eyes: { eyes: "wet" },
  sparkle_sweats: { effect: "sparkles" },
  thought_leader_blazer: { outfit: "blazer" },
  veneer_grin: { mouth: "veneers" },
  cursor_eyes: { eyes: "cursor" },
  keyboard_spine: { back: "keyboard" },
  free_range_frame: { body: "lean" },
  mud_crown: { outfit: "cap" },
};

const DIET_BASE_APPEARANCE: Record<FoodKind, Partial<HogAppearance>> = {
  ai_image: { body: "huge" },
  generated_post: { body: "round" },
  chatbot_screenshot: { body: "round", mouth: "flat", effect: "chat" },
  human_post: { eyes: "judging", mouth: "flat" },
  shitpost: { body: "round", eyes: "shades", mouth: "grin", effect: "flies" },
};

export function appearanceForState(
  state: Pick<GameState, "taste" | "equippedMutations">,
): HogAppearance {
  const favorite = favoriteFood(state.taste);
  const namedAppearance = favorite === null ? BASE_HOG : DIET_APPEARANCES[favorite];
  return state.equippedMutations.reduce<HogAppearance>(
    (appearance, mutation) => ({ ...appearance, ...MUTATION_APPEARANCE[mutation] }),
    {
      ...BASE_HOG,
      variant: namedAppearance.variant,
      name: namedAppearance.name,
      description: namedAppearance.description,
      ...(favorite === null ? {} : DIET_BASE_APPEARANCE[favorite]),
    },
  );
}

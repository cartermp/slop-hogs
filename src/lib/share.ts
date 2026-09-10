import {
  favoriteFood,
  MUTATION_CATALOG,
  type FoodKind,
  type GameState,
  type MutationId,
} from "./game.ts";

export const SHARE_SPEECH_MAX_LENGTH = 280;

export type ShareActionFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type ShareEventView = {
  id: string;
  mutation: MutationId;
  mutationName: string;
  eventText: string;
  speech: string;
  appearanceName: string;
  cardReady: boolean;
};

const dietOpeners: Record<FoodKind | "mixed", readonly string[]> = {
  ai_image: [
    "The prompt was unclear, but the consequences are in 4K.",
    "Another premium visual outcome nobody ordered.",
  ],
  generated_post: [
    "Thrilled to announce a completely involuntary growth milestone.",
    "Some personal news from the thought-leadership trough.",
  ],
  chatbot_screenshot: [
    "The cursor stopped blinking long enough to make this official.",
    "It searched its context window and found a new problem.",
  ],
  human_post: [
    "A real person posted, and the hog developed situational awareness.",
    "Organic content has produced an inorganic consequence.",
  ],
  shitpost: [
    "Posting through it has changed the hog at a cellular level.",
    "The mud timeline has selected its champion.",
  ],
  mixed: [
    "A balanced diet was attempted. This happened instead.",
    "The feed contained multitudes, most of them indigestible.",
  ],
};

const mutationClosers: Record<MutationId, string> = {
  glazed_eyes: "Please respect its new luxury stare.",
  sparkle_sweats: "The glitter is permanent and the warranty is void.",
  thought_leader_blazer: "It is now available for keynotes and absolutely nothing else.",
  veneer_grin: "Every tooth has a personal brand.",
  cursor_eyes: "One eye is still waiting for a complete response.",
  keyboard_spine: "The mechanical switches are, regrettably, load-bearing.",
  free_range_frame: "It can see the whole discourse and wishes it could not.",
  mud_crown: "The timeline has recognized its rightful monarch.",
};

function selectionIndex(key: string, length: number): number {
  let hash = 0;
  for (const character of key) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

export function createSpeechDraft(
  state: Pick<GameState, "taste">,
  mutation: MutationId,
  eventKey: string,
): string {
  const favorite = favoriteFood(state.taste) ?? "mixed";
  const openers = dietOpeners[favorite];
  const mutationName = MUTATION_CATALOG.find(entry => entry.id === mutation)?.name;
  if (!mutationName) throw new Error("Unknown share-event mutation");
  const speech = `${openers[selectionIndex(eventKey, openers.length)]} ${mutationName} unlocked. ${mutationClosers[mutation]}`;
  if (speech.length > SHARE_SPEECH_MAX_LENGTH) throw new Error("Authored speech template exceeds the share limit");
  return speech;
}

export function parseShareSpeech(input: unknown): string {
  if (typeof input !== "string") throw new Error("Speech must be text");
  const speech = input.trim();
  if (!speech || speech.length > SHARE_SPEECH_MAX_LENGTH) {
    throw new Error(`Speech must contain 1 to ${SHARE_SPEECH_MAX_LENGTH} characters`);
  }
  return speech;
}

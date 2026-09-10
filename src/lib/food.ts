export const FOOD_KINDS = [
  "ai_image",
  "generated_post",
  "chatbot_screenshot",
  "human_post",
  "shitpost",
] as const;

export type FoodKind = (typeof FOOD_KINDS)[number];

export const FOOD_LABELS: Record<FoodKind, string> = {
  ai_image: "AI image glaze",
  generated_post: "Generated-post gravy",
  chatbot_screenshot: "Chatbot screenshot crunch",
  human_post: "Suspiciously human",
  shitpost: "Classic shitpost",
};

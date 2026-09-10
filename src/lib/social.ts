import { FOOD_KINDS, type FoodKind, type GameResult, type GameState } from "./game.ts";
import type { TombstoneView } from "./server/lifecycle.ts";

export const GIFT_STATUSES = ["pending", "accepted", "declined"] as const;
export type GiftStatus = (typeof GIFT_STATUSES)[number];

export interface PublicPen {
  penId: string;
  hogId: string | null;
  state: GameState | null;
  giftsEnabled: boolean;
  tombstones: TombstoneView[];
}

export interface PendingGift {
  id: string;
  senderDid: string;
  food: FoodKind;
  createdAt: Date;
}

export interface PenManagement {
  penId: string;
  isPublic: boolean;
  giftsEnabled: boolean;
  pendingGifts: PendingGift[];
  blockedDids: string[];
}

export interface GiftReceipt {
  id: string;
  food: FoodKind;
  createdAt: Date;
}

export interface GiftAcceptance {
  giftId: string;
  result: GameResult;
}

export interface SocialActionFormState {
  status: "idle" | "success" | "error";
  message: string;
  requestId: string;
}

export function parseGiftFood(value: unknown): FoodKind {
  if (typeof value !== "string" || !FOOD_KINDS.includes(value as FoodKind)) {
    throw new Error("Invalid gift treat");
  }
  return value as FoodKind;
}

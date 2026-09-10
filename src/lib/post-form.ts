import type { FoodKind } from "./food.ts";

export interface PreviewSummary {
  canonicalUri: string;
  cid: string;
  authorDid: string;
  authorHandle: string;
  authorDisplayName: string | null;
  text: string;
  indexedAt: string | null;
  postUrl: string;
}

export type PreviewFormState =
  | { status: "idle"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; message: string; preview: PreviewSummary; feedRequestId: string };

export type FeedFormState =
  | { status: "idle"; message: string }
  | { status: "error"; message: string }
  | {
      status: "fed";
      message: string;
      food: FoodKind;
      mealsAvailable: number;
      mealsEaten: number;
    };

"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { FOOD_KINDS, GameError, type FoodKind } from "@/lib/game";
import type { FeedFormState, PreviewFormState } from "@/lib/post-form";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import {
  DuplicatePostError,
  feedHogFromPost,
  getAppSession,
  PostPreviewExpiredError,
} from "@/lib/server/hogs";
import { parseAppOrigin } from "@/lib/server/oauth-config";
import {
  InvalidPostUrlError,
  PostLookupError,
  PostLookupRateLimitError,
  PostUnavailableError,
  PreviewDisabledError,
  previewPost,
} from "@/lib/server/posts";

const cookieName = "slop_hogs_session";

async function requireSameOriginToken(): Promise<string> {
  const requestOrigin = (await headers()).get("origin");
  if (requestOrigin !== parseAppOrigin(process.env.APP_ORIGIN)) throw new Error("Forbidden");
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) throw new Error("Unauthorized");
  return token;
}

function errorState(error: unknown): { status: "error"; message: string } {
  if (error instanceof InvalidPostUrlError) return { status: "error", message: error.message };
  if (error instanceof PreviewDisabledError) return { status: "error", message: "Post previews are temporarily disabled." };
  if (error instanceof PostLookupRateLimitError) {
    return { status: "error", message: "The preview allowance is used up. Try again after the quota resets." };
  }
  if (error instanceof PostUnavailableError) {
    return { status: "error", message: "That post is deleted, private, or otherwise unavailable." };
  }
  if (error instanceof PostLookupError) return { status: "error", message: error.message };
  if (error instanceof DuplicatePostError || error instanceof PostPreviewExpiredError) {
    return { status: "error", message: error.message };
  }
  if (error instanceof GameError && error.code === "NO_MEALS_AVAILABLE") {
    return { status: "error", message: "Your hog has eaten every available meal." };
  }
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) {
    return { status: "error", message: "Your session is no longer valid. Sign in again." };
  }
  const message = error instanceof Error ? error.message : "Unknown post feeding failure";
  console.error(`Post feeding failed: ${message}`);
  return { status: "error", message: "Post feeding is temporarily unavailable." };
}

export async function previewPostAction(
  _previous: PreviewFormState,
  formData: FormData,
): Promise<PreviewFormState> {
  try {
    const rawUrl = formData.get("postUrl");
    if (typeof rawUrl !== "string") throw new InvalidPostUrlError("Enter a Bluesky post URL");
    const policy = loadCostPolicy();
    const preview = await previewPost(getDatabase(), await requireSameOriginToken(), rawUrl, {
      enabled: policy.features.externalPreviews,
      limits: policy.limits,
    });
    return {
      status: "ready",
      message: "Post found. Choose the flavor before feeding.",
      preview,
      feedRequestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error);
  }
}

export async function feedPostAction(
  _previous: FeedFormState,
  formData: FormData,
): Promise<FeedFormState> {
  try {
    const sourceUri = formData.get("sourceUri");
    const sourceCid = formData.get("sourceCid");
    const requestId = formData.get("requestId");
    const food = formData.get("food");
    if (
      typeof sourceUri !== "string"
      || typeof sourceCid !== "string"
      || typeof requestId !== "string"
      || typeof food !== "string"
      || !FOOD_KINDS.includes(food as FoodKind)
    ) {
      throw new Error("Invalid post meal");
    }
    const policy = loadCostPolicy();
    if (!policy.features.externalPreviews) throw new PreviewDisabledError("Post previews are disabled");
    const token = await requireSameOriginToken();
    const session = await getAppSession(getDatabase(), token);
    if (!session) throw new Error("Unauthorized");
    const result = await feedHogFromPost(
      getDatabase(),
      token,
      session.hogId,
      requestId,
      food as FoodKind,
      sourceUri,
      sourceCid,
    );
    return {
      status: "fed",
      message: "The post is now inside your hog. No refunds.",
      food: food as FoodKind,
      mealsAvailable: result.state.mealsAvailable,
      mealsEaten: result.state.mealsEaten,
    };
  } catch (error) {
    return errorState(error);
  }
}

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { FOOD_KINDS, type FoodKind } from "@/lib/food";
import { GameError } from "@/lib/game";
import type { FeedFormState, PreviewFormState } from "@/lib/post-form";
import { requireSameOriginSession } from "@/lib/server/action-auth";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import {
  DuplicatePostError,
  feedHogFromPost,
  PostPreviewExpiredError,
} from "@/lib/server/hogs";
import { startServerActivity, type ActivityOutcome } from "@/lib/server/logging";
import {
  InvalidPostUrlError,
  PostLookupError,
  PostLookupRateLimitError,
  PostUnavailableError,
  PreviewDisabledError,
  previewPost,
} from "@/lib/server/posts";

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
  return { status: "error", message: "Post feeding is temporarily unavailable." };
}

function errorOutcome(error: unknown): ActivityOutcome {
  if (
    error instanceof InvalidPostUrlError
    || error instanceof PreviewDisabledError
    || error instanceof PostUnavailableError
    || error instanceof DuplicatePostError
    || error instanceof PostPreviewExpiredError
    || error instanceof GameError
  ) return "rejected";
  if (error instanceof PostLookupRateLimitError) return "rate_limited";
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) return "denied";
  return "failure";
}

export async function previewPostAction(
  _previous: PreviewFormState,
  formData: FormData,
): Promise<PreviewFormState> {
  const event = startServerActivity("post.preview", { activity_kind: "server_action" });
  try {
    const rawUrl = formData.get("postUrl");
    if (typeof rawUrl !== "string") throw new InvalidPostUrlError("Enter a Bluesky post URL");
    const policy = loadCostPolicy();
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({ actor_did: session.ownerDid, hog_id: session.hogId });
    const preview = await previewPost(database, token, rawUrl, {
      enabled: policy.features.externalPreviews,
      limits: policy.limits,
    });
    event.emit("success", {
      post_uri: preview.canonicalUri,
      post_author_did: preview.authorDid,
      post_author_handle: preview.authorHandle,
      post_text_length: preview.text.length,
    });
    return {
      status: "ready",
      message: "Post found. Choose the flavor before feeding.",
      preview,
      feedRequestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error);
    event.emit(errorOutcome(error), { response_status: state.status }, error);
    return state;
  }
}

export async function feedPostAction(
  _previous: FeedFormState,
  formData: FormData,
): Promise<FeedFormState> {
  const event = startServerActivity("post.feed", { activity_kind: "server_action" });
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
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    if (!session.hogId) throw new Error("Unauthorized");
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      food,
      post_uri: sourceUri,
      post_cid: sourceCid,
    });
    const result = await feedHogFromPost(
      database,
      token,
      session.hogId,
      requestId,
      food as FoodKind,
      sourceUri,
      sourceCid,
    );
    revalidatePath("/");
    revalidatePath("/pen/[penId]", "page");
    const ending = result.events.find(event => event.type === "life_ended");
    event.emit("success", {
      meals_available: result.state.mealsAvailable,
      meals_eaten: result.state.mealsEaten,
      event_types: result.events.map(item => item.type),
      life_ended: ending?.type === "life_ended",
    });
    return {
      status: "fed",
      message: ending?.type === "life_ended"
        ? `${ending.name}. ${ending.epitaph}`
        : "The post is now inside your hog. No refunds.",
      food: food as FoodKind,
      mealsAvailable: result.state.mealsAvailable,
      mealsEaten: result.state.mealsEaten,
    };
  } catch (error) {
    const state = errorState(error);
    event.emit(errorOutcome(error), { response_status: state.status }, error);
    return state;
  }
}

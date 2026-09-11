"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { GameError } from "@/lib/game";
import { parseGiftFood, type SocialActionFormState } from "@/lib/social";
import { requireSameOriginSession } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
import { startServerActivity, type ActivityOutcome } from "@/lib/server/logging";
import { ReadOnlyError } from "@/lib/server/operations";
import {
  acceptGift,
  declineGift,
  GiftLimitError,
  GiftStateError,
  GiftUnavailableError,
  sendGift,
  setAccountBlock,
  setPenSetting,
} from "@/lib/server/social";

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || !value) throw new Error("Invalid social action");
  return value;
}

function errorState(error: unknown, requestId: string): SocialActionFormState {
  if (
    error instanceof GiftLimitError
    || error instanceof GiftStateError
    || error instanceof GiftUnavailableError
  ) {
    return { status: "error", message: error.message, requestId };
  }
  if (error instanceof GameError && error.code === "NO_MEALS_AVAILABLE") {
    return {
      status: "error",
      message: "The meal tray is empty. One slot returns every four hours.",
      requestId,
    };
  }
  if (error instanceof ReadOnlyError) {
    return { status: "error", message: "Slop Hogs is temporarily read-only.", requestId };
  }
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) {
    return { status: "error", message: "Your session is no longer valid. Sign in again.", requestId };
  }
  return { status: "error", message: "The pen gate is temporarily stuck.", requestId };
}

function errorOutcome(error: unknown): ActivityOutcome {
  if (
    error instanceof GiftLimitError
    || error instanceof GiftStateError
    || error instanceof GiftUnavailableError
    || error instanceof ReadOnlyError
    || error instanceof GameError
  ) return "rejected";
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) return "denied";
  return "failure";
}

export async function sendGiftAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("gift.send", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readString(formData, "requestId");
    const penId = readString(formData, "penId");
    const food = parseGiftFood(formData.get("food"));
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      target_pen_id: penId,
      food,
    });
    const gift = await sendGift(database, token, penId, requestId, food);
    event.emit("success", { gift_id: gift.id, gift_created_at: gift.createdAt });
    return {
      status: "success",
      message: "Treat delivered. The owner decides whether it reaches the hog.",
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

export async function setPenSettingAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("pen.setting.update", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readString(formData, "requestId");
    const setting = readString(formData, "setting");
    if (setting !== "pen_public" && setting !== "gifts_enabled") throw new Error("Invalid pen setting");
    const rawEnabled = readString(formData, "enabled");
    if (rawEnabled !== "true" && rawEnabled !== "false") throw new Error("Invalid pen setting");
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      setting,
      enabled: rawEnabled === "true",
    });
    const penId = await setPenSetting(database, token, setting, rawEnabled === "true");
    revalidatePath("/");
    revalidatePath(`/pen/${penId}`);
    event.emit("success", { pen_id: penId });
    return {
      status: "success",
      message: setting === "pen_public"
        ? `Public pen ${rawEnabled === "true" ? "opened" : "hidden"}.`
        : `Visitor treats ${rawEnabled === "true" ? "enabled" : "disabled"}.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

export async function acceptGiftAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("gift.accept", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readString(formData, "requestId");
    const giftId = readString(formData, "giftId");
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      gift_id: giftId,
    });
    const accepted = await acceptGift(database, token, giftId, requestId);
    revalidatePath("/");
    revalidatePath("/pen/[penId]", "page");
    const ending = accepted.result.events.find(event => event.type === "life_ended");
    event.emit("success", {
      meals_available: accepted.result.state.mealsAvailable,
      meals_eaten: accepted.result.state.mealsEaten,
      event_types: accepted.result.events.map(item => item.type),
      life_ended: ending?.type === "life_ended",
    });
    return {
      status: "success",
      message: ending?.type === "life_ended"
        ? `${ending.name}. ${ending.epitaph}`
        : `Treat accepted. ${accepted.result.state.mealsAvailable} meals remain.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

export async function declineGiftAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("gift.decline", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readString(formData, "requestId");
    const giftId = readString(formData, "giftId");
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      gift_id: giftId,
    });
    await declineGift(database, token, giftId);
    revalidatePath("/");
    event.emit("success");
    return {
      status: "success",
      message: "Treat discarded.",
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

export async function setAccountBlockAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("account.block.update", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readString(formData, "requestId");
    const did = readString(formData, "did").trim();
    const rawBlocked = readString(formData, "blocked");
    if (rawBlocked !== "true" && rawBlocked !== "false") throw new Error("Invalid block setting");
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      target_did: did,
      blocked: rawBlocked === "true",
    });
    await setAccountBlock(database, token, did, rawBlocked === "true");
    revalidatePath("/");
    event.emit("success");
    return {
      status: "success",
      message: rawBlocked === "true" ? "Account blocked and pending treats discarded." : "Account unblocked.",
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

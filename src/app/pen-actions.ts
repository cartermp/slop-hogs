"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { GameError } from "@/lib/game";
import { parseGiftFood, type SocialActionFormState } from "@/lib/social";
import { requireSameOriginToken } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
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
  const message = error instanceof Error ? error.message : "Unknown social action failure";
  console.error(`Social action failed: ${message}`);
  return { status: "error", message: "The pen gate is temporarily stuck.", requestId };
}

export async function sendGiftAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  try {
    requestId = readString(formData, "requestId");
    const penId = readString(formData, "penId");
    const food = parseGiftFood(formData.get("food"));
    const token = await requireSameOriginToken();
    await sendGift(getDatabase(), token, penId, requestId, food);
    return {
      status: "success",
      message: "Treat delivered. The owner decides whether it reaches the hog.",
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

export async function setPenSettingAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  try {
    requestId = readString(formData, "requestId");
    const setting = readString(formData, "setting");
    if (setting !== "pen_public" && setting !== "gifts_enabled") throw new Error("Invalid pen setting");
    const rawEnabled = readString(formData, "enabled");
    if (rawEnabled !== "true" && rawEnabled !== "false") throw new Error("Invalid pen setting");
    const token = await requireSameOriginToken();
    const penId = await setPenSetting(getDatabase(), token, setting, rawEnabled === "true");
    revalidatePath("/");
    revalidatePath(`/pen/${penId}`);
    return {
      status: "success",
      message: setting === "pen_public"
        ? `Public pen ${rawEnabled === "true" ? "opened" : "hidden"}.`
        : `Visitor treats ${rawEnabled === "true" ? "enabled" : "disabled"}.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

export async function acceptGiftAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  try {
    requestId = readString(formData, "requestId");
    const giftId = readString(formData, "giftId");
    const token = await requireSameOriginToken();
    const accepted = await acceptGift(getDatabase(), token, giftId, requestId);
    revalidatePath("/");
    return {
      status: "success",
      message: `Treat accepted. ${accepted.result.state.mealsAvailable} meals remain.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

export async function declineGiftAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  try {
    requestId = readString(formData, "requestId");
    const giftId = readString(formData, "giftId");
    const token = await requireSameOriginToken();
    await declineGift(getDatabase(), token, giftId);
    revalidatePath("/");
    return {
      status: "success",
      message: "Treat discarded.",
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

export async function setAccountBlockAction(
  previous: SocialActionFormState,
  formData: FormData,
): Promise<SocialActionFormState> {
  let requestId = previous.requestId;
  try {
    requestId = readString(formData, "requestId");
    const did = readString(formData, "did").trim();
    const rawBlocked = readString(formData, "blocked");
    if (rawBlocked !== "true" && rawBlocked !== "false") throw new Error("Invalid block setting");
    const token = await requireSameOriginToken();
    await setAccountBlock(getDatabase(), token, did, rawBlocked === "true");
    revalidatePath("/");
    return {
      status: "success",
      message: rawBlocked === "true" ? "Account blocked and pending treats discarded." : "Account unblocked.",
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

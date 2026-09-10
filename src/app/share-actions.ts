"use server";

import { revalidatePath } from "next/cache";
import type { ShareActionFormState } from "@/lib/share";
import { requireSameOriginToken } from "@/lib/server/action-auth";
import {
  CardLimitError,
  CardRenderBusyError,
  CardUnavailableError,
  requestShareCard,
  updateShareSpeech,
} from "@/lib/server/share-cards";
import { getDatabase } from "@/lib/server/database";

function value(formData: FormData, name: string): string {
  const result = formData.get(name);
  if (typeof result !== "string" || !result) throw new Error("Invalid share action");
  return result;
}

function errorState(error: unknown): ShareActionFormState {
  if (
    error instanceof CardLimitError
    || error instanceof CardRenderBusyError
    || error instanceof CardUnavailableError
  ) {
    return { status: "error", message: error.message };
  }
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) {
    return { status: "error", message: "Your session is no longer valid. Sign in again." };
  }
  const message = error instanceof Error ? error.message : "Unknown share action failure";
  if (message.startsWith("Speech must")) return { status: "error", message };
  console.error(`Share action failed: ${message}`);
  return { status: "error", message: "The share desk is temporarily jammed." };
}

export async function updateShareSpeechAction(
  _previous: ShareActionFormState,
  formData: FormData,
): Promise<ShareActionFormState> {
  try {
    const eventId = value(formData, "eventId");
    const token = await requireSameOriginToken();
    await updateShareSpeech(getDatabase(), token, eventId, formData.get("speech"));
    revalidatePath("/");
    revalidatePath(`/share/${eventId}`);
    return { status: "success", message: "Draft saved." };
  } catch (error) {
    return errorState(error);
  }
}

export async function renderShareCardAction(
  _previous: ShareActionFormState,
  formData: FormData,
): Promise<ShareActionFormState> {
  try {
    const eventId = value(formData, "eventId");
    const token = await requireSameOriginToken();
    await requestShareCard(getDatabase(), token, eventId);
    revalidatePath("/");
    revalidatePath(`/share/${eventId}`);
    return { status: "success", message: "Immutable share card rendered." };
  } catch (error) {
    return errorState(error);
  }
}

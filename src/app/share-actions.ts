"use server";

import { revalidatePath } from "next/cache";
import type { ShareActionFormState } from "@/lib/share";
import { requireSameOriginSession } from "@/lib/server/action-auth";
import {
  CardLimitError,
  CardRenderBusyError,
  CardUnavailableError,
  requestShareCard,
  updateShareSpeech,
} from "@/lib/server/share-cards";
import { getDatabase } from "@/lib/server/database";
import { startServerActivity, type ActivityOutcome } from "@/lib/server/logging";

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
  return { status: "error", message: "The share desk is temporarily jammed." };
}

function errorOutcome(error: unknown): ActivityOutcome {
  if (
    error instanceof CardLimitError
    || error instanceof CardRenderBusyError
    || error instanceof CardUnavailableError
    || (error instanceof Error && error.message.startsWith("Speech must"))
  ) return "rejected";
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) return "denied";
  return "failure";
}

export async function updateShareSpeechAction(
  _previous: ShareActionFormState,
  formData: FormData,
): Promise<ShareActionFormState> {
  const event = startServerActivity("share.speech.update", { activity_kind: "server_action" });
  try {
    const eventId = value(formData, "eventId");
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    const speech = await updateShareSpeech(database, token, eventId, formData.get("speech"));
    event.add({ actor_did: session.ownerDid, hog_id: session.hogId, share_event_id: eventId });
    revalidatePath("/");
    revalidatePath(`/share/${eventId}`);
    event.emit("success", { speech_length: speech.length });
    return { status: "success", message: "Draft saved." };
  } catch (error) {
    const state = errorState(error);
    event.emit(errorOutcome(error), { response_status: state.status }, error);
    return state;
  }
}

export async function renderShareCardAction(
  _previous: ShareActionFormState,
  formData: FormData,
): Promise<ShareActionFormState> {
  const event = startServerActivity("share.card.render", { activity_kind: "server_action" });
  try {
    const eventId = value(formData, "eventId");
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({ actor_did: session.ownerDid, hog_id: session.hogId, share_event_id: eventId });
    await requestShareCard(database, token, eventId);
    revalidatePath("/");
    revalidatePath(`/share/${eventId}`);
    event.emit("success");
    return { status: "success", message: "Immutable share card rendered." };
  } catch (error) {
    const state = errorState(error);
    event.emit(errorOutcome(error), { response_status: state.status }, error);
    return state;
  }
}

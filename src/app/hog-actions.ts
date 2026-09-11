"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { FOOD_KINDS, type FoodKind } from "@/lib/food";
import { GameError, MUTATION_CATALOG } from "@/lib/game";
import type { HogActionFormState } from "@/lib/hog-form";
import { requireSameOriginSession } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
import { cleanHog, feedHog } from "@/lib/server/hogs";
import { startServerActivity, type ActivityOutcome } from "@/lib/server/logging";

function errorState(error: unknown, requestId: string): HogActionFormState {
  if (error instanceof GameError) {
    const messages: Partial<Record<GameError["code"], string>> = {
      NO_MEALS_AVAILABLE: "The tray is empty. One meal returns every four hours.",
      ALREADY_CLEAN: "Your hog is already suspiciously clean.",
      CLEANING_COOLDOWN: "The wash trough is still draining. Try again later.",
    };
    const message = messages[error.code];
    if (message) return { status: "error", message, requestId };
  }
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) {
    return { status: "error", message: "Your session is no longer valid. Sign in again.", requestId };
  }
  return { status: "error", message: "Your hog is temporarily refusing care.", requestId };
}

function errorOutcome(error: unknown): ActivityOutcome {
  if (error instanceof GameError) return "rejected";
  if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) return "denied";
  return "failure";
}

function readRequestId(formData: FormData): string {
  const requestId = formData.get("requestId");
  if (typeof requestId !== "string") throw new Error("Invalid action request");
  return requestId;
}

export async function feedTrayAction(
  previous: HogActionFormState,
  formData: FormData,
): Promise<HogActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("hog.feed", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readRequestId(formData);
    const food = formData.get("food");
    if (typeof food !== "string" || !FOOD_KINDS.includes(food as FoodKind)) {
      throw new Error("Invalid tray meal");
    }
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    if (!session.hogId) throw new Error("Unauthorized");
    event.add({
      request_id: requestId,
      actor_did: session.ownerDid,
      hog_id: session.hogId,
      food,
    });
    const result = await feedHog(
      database,
      token,
      session.hogId,
      requestId,
      { type: "feed", food },
    );
    const discovery = result.events.find(event => event.type === "mutation_discovered");
    const ending = result.events.find(event => event.type === "life_ended");
    const mutation = discovery?.type === "mutation_discovered"
      ? MUTATION_CATALOG.find(entry => entry.id === discovery.mutation)
      : null;
    revalidatePath("/");
    revalidatePath("/pen/[penId]", "page");
    event.emit("success", {
      meals_available: result.state.mealsAvailable,
      meals_eaten: result.state.mealsEaten,
      event_types: result.events.map(item => item.type),
      mutation_id: discovery?.type === "mutation_discovered" ? discovery.mutation : undefined,
      life_ended: ending?.type === "life_ended",
    });
    return {
      status: "success",
      message: ending?.type === "life_ended"
        ? `${ending.name}. ${ending.epitaph}`
        : mutation
        ? `Mutation discovered: ${mutation.name}. ${discovery!.text}`
        : `Meal accepted. ${result.state.mealsAvailable} remain in the tray.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

export async function cleanHogAction(
  previous: HogActionFormState,
  formData: FormData,
): Promise<HogActionFormState> {
  let requestId = previous.requestId;
  const event = startServerActivity("hog.clean", { activity_kind: "server_action", request_id: requestId });
  try {
    requestId = readRequestId(formData);
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    if (!session.hogId) throw new Error("Unauthorized");
    event.add({ request_id: requestId, actor_did: session.ownerDid, hog_id: session.hogId });
    const result = await cleanHog(database, token, session.hogId, requestId);
    const cleaned = result.events.find(event => event.type === "cleaned");
    if (!cleaned || cleaned.type !== "cleaned") throw new Error("Cleaning result is missing");
    revalidatePath("/");
    revalidatePath("/pen/[penId]", "page");
    event.emit("success", {
      filth_removed: cleaned.filthRemoved,
      filth_after: result.state.stats.filth,
      event_types: result.events.map(item => item.type),
    });
    return {
      status: "success",
      message: `Washed off ${cleaned.filthRemoved} filth. The trough needs four hours to drain.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    const state = errorState(error, requestId);
    event.emit(errorOutcome(error), { response_status: state.status, request_id: requestId }, error);
    return state;
  }
}

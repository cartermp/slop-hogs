"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { FOOD_KINDS, type FoodKind } from "@/lib/food";
import { GameError, MUTATION_CATALOG } from "@/lib/game";
import type { HogActionFormState } from "@/lib/hog-form";
import { requireSameOriginToken } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
import { cleanHog, feedHog, getAppSession } from "@/lib/server/hogs";

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
  const message = error instanceof Error ? error.message : "Unknown hog action failure";
  console.error(`Hog action failed: ${message}`);
  return { status: "error", message: "Your hog is temporarily refusing care.", requestId };
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
  try {
    requestId = readRequestId(formData);
    const food = formData.get("food");
    if (typeof food !== "string" || !FOOD_KINDS.includes(food as FoodKind)) {
      throw new Error("Invalid tray meal");
    }
    const token = await requireSameOriginToken();
    const session = await getAppSession(getDatabase(), token);
    if (!session) throw new Error("Unauthorized");
    const result = await feedHog(
      getDatabase(),
      token,
      session.hogId,
      requestId,
      { type: "feed", food },
    );
    const discovery = result.events.find(event => event.type === "mutation_discovered");
    const mutation = discovery?.type === "mutation_discovered"
      ? MUTATION_CATALOG.find(entry => entry.id === discovery.mutation)
      : null;
    revalidatePath("/");
    return {
      status: "success",
      message: mutation
        ? `Mutation discovered: ${mutation.name}. ${discovery!.text}`
        : `Meal accepted. ${result.state.mealsAvailable} remain in the tray.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

export async function cleanHogAction(
  previous: HogActionFormState,
  formData: FormData,
): Promise<HogActionFormState> {
  let requestId = previous.requestId;
  try {
    requestId = readRequestId(formData);
    const token = await requireSameOriginToken();
    const session = await getAppSession(getDatabase(), token);
    if (!session) throw new Error("Unauthorized");
    const result = await cleanHog(getDatabase(), token, session.hogId, requestId);
    const cleaned = result.events.find(event => event.type === "cleaned");
    if (!cleaned || cleaned.type !== "cleaned") throw new Error("Cleaning result is missing");
    revalidatePath("/");
    return {
      status: "success",
      message: `Washed off ${cleaned.filthRemoved} filth. The trough needs four hours to drain.`,
      requestId: randomUUID(),
    };
  } catch (error) {
    return errorState(error, requestId);
  }
}

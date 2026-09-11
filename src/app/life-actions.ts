"use server";

import { revalidatePath } from "next/cache";
import type { LifeActionFormState } from "@/lib/life-form";
import { requireSameOriginSession } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
import { startNextGeneration } from "@/lib/server/lifecycle";
import { startServerActivity } from "@/lib/server/logging";
import { ReadOnlyError } from "@/lib/server/operations";

export async function startNextGenerationAction(
  _previous: LifeActionFormState,
  _formData: FormData,
): Promise<LifeActionFormState> {
  const event = startServerActivity("hog.generation.start", { activity_kind: "server_action" });
  try {
    const database = getDatabase();
    const { token, session } = await requireSameOriginSession(database);
    event.add({ actor_did: session.ownerDid, previous_hog_id: session.hogId });
    const next = await startNextGeneration(database, token);
    revalidatePath("/");
    revalidatePath(`/pen/${next.penId}`);
    event.emit("success", {
      hog_id: next.hogId,
      pen_id: next.penId,
      generation: next.generation,
    });
    return {
      status: "success",
      message: `Generation ${next.generation} has entered the pen.`,
    };
  } catch (error) {
    const outcome = error instanceof ReadOnlyError
      ? "rejected"
      : error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)
      ? "denied"
      : "failure";
    event.emit(outcome, { response_status: "error" }, error);
    if (error instanceof ReadOnlyError) {
      return { status: "error", message: "Slop Hogs is temporarily read-only." };
    }
    if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) {
      return { status: "error", message: "Your session is no longer valid. Sign in again." };
    }
    return { status: "error", message: "The next generation is temporarily stuck backstage." };
  }
}

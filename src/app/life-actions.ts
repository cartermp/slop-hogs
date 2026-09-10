"use server";

import { revalidatePath } from "next/cache";
import type { LifeActionFormState } from "@/lib/life-form";
import { requireSameOriginToken } from "@/lib/server/action-auth";
import { getDatabase } from "@/lib/server/database";
import { startNextGeneration } from "@/lib/server/lifecycle";
import { ReadOnlyError } from "@/lib/server/operations";

export async function startNextGenerationAction(
  _previous: LifeActionFormState,
  _formData: FormData,
): Promise<LifeActionFormState> {
  try {
    const token = await requireSameOriginToken();
    const next = await startNextGeneration(getDatabase(), token);
    revalidatePath("/");
    revalidatePath(`/pen/${next.penId}`);
    return {
      status: "success",
      message: `Generation ${next.generation} has entered the pen.`,
    };
  } catch (error) {
    if (error instanceof ReadOnlyError) {
      return { status: "error", message: "Slop Hogs is temporarily read-only." };
    }
    if (error instanceof Error && ["Unauthorized", "Forbidden"].includes(error.message)) {
      return { status: "error", message: "Your session is no longer valid. Sign in again." };
    }
    const message = error instanceof Error ? error.message : "Unknown generation failure";
    console.error(`Next generation failed: ${message}`);
    return { status: "error", message: "The next generation is temporarily stuck backstage." };
  }
}

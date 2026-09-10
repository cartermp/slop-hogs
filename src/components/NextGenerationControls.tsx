"use client";

import { useActionState } from "react";
import { startNextGenerationAction } from "@/app/life-actions";
import type { LifeActionFormState } from "@/lib/life-form";

const initialState: LifeActionFormState = { status: "idle", message: "" };

export function NextGenerationControls() {
  const [state, action, pending] = useActionState(startNextGenerationAction, initialState);
  return (
    <section className="next-generation" aria-labelledby="next-generation-title">
      <p className="eyebrow">The bloodline continues</p>
      <h2 id="next-generation-title">Make the same mistake again.</h2>
      <p>The next hog starts fresh in this pen. Every tombstone stays in the family history.</p>
      <form action={action}>
        <button className="auth-button" type="submit" disabled={pending}>
          {pending ? "Opening the pen..." : "Begin next generation"}
        </button>
      </form>
      {state.message && (
        <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
          {state.message}
        </p>
      )}
    </section>
  );
}

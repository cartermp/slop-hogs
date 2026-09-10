"use client";

import { useActionState } from "react";
import { sendGiftAction } from "@/app/pen-actions";
import { FOOD_KINDS, FOOD_LABELS } from "@/lib/food";
import type { SocialActionFormState } from "@/lib/social";

export function GiftTreatForm({ penId, requestId }: { penId: string; requestId: string }) {
  const [state, action, pending] = useActionState(sendGiftAction, {
    status: "idle",
    message: "",
    requestId,
  } satisfies SocialActionFormState);
  return (
    <form action={action} className="gift-form">
      <input type="hidden" name="penId" value={penId} />
      <input type="hidden" name="requestId" value={state.requestId} />
      <label htmlFor="gift-food">Leave a treat</label>
      <div>
        <select id="gift-food" name="food" defaultValue="shitpost">
          {FOOD_KINDS.map(food => <option key={food} value={food}>{FOOD_LABELS[food]}</option>)}
        </select>
        <button className="auth-button" type="submit" disabled={pending}>
          {pending ? "Delivering..." : "Send treat"}
        </button>
      </div>
      <p className="recipe-note">One treat per pen each UTC day. The owner must accept it before anything changes.</p>
      {state.message && (
        <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
          {state.message}
        </p>
      )}
    </form>
  );
}

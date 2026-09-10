"use client";

import { useActionState } from "react";
import { cleanHogAction, feedTrayAction } from "@/app/hog-actions";
import { FOOD_KINDS, FOOD_LABELS } from "@/lib/food";
import type { HogActionFormState } from "@/lib/hog-form";

function ActionMessage({ state }: { state: HogActionFormState }) {
  if (!state.message) return null;
  return (
    <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
      {state.message}
    </p>
  );
}

export function HogControls({
  feedRequestId,
  cleanRequestId,
}: {
  feedRequestId: string;
  cleanRequestId: string;
}) {
  const [feedState, feedAction, feeding] = useActionState(feedTrayAction, {
    status: "idle",
    message: "",
    requestId: feedRequestId,
  } satisfies HogActionFormState);
  const [cleanState, cleanAction, cleaning] = useActionState(cleanHogAction, {
    status: "idle",
    message: "",
    requestId: cleanRequestId,
  } satisfies HogActionFormState);

  return (
    <section className="hog-controls" aria-labelledby="care-title">
      <p className="eyebrow">Daily care</p>
      <h2 id="care-title">Keep the problem alive.</h2>
      <div className="care-grid">
        <form action={feedAction} className="care-card">
          <h3>Meal tray</h3>
          <p>Built-in slop always works. One empty slot refills every four hours.</p>
          <input type="hidden" name="requestId" value={feedState.requestId} />
          <label htmlFor="tray-food">Choose a flavor</label>
          <select id="tray-food" name="food" defaultValue="shitpost">
            {FOOD_KINDS.map(food => <option key={food} value={food}>{FOOD_LABELS[food]}</option>)}
          </select>
          <button className="auth-button" type="submit" disabled={feeding}>
            {feeding ? "Feeding..." : "Feed from tray"}
          </button>
          <ActionMessage state={feedState} />
        </form>
        <form action={cleanAction} className="care-card">
          <h3>Wash trough</h3>
          <p>Remove up to 30 filth without spending a meal. The trough drains for four hours.</p>
          <input type="hidden" name="requestId" value={cleanState.requestId} />
          <button className="auth-button" type="submit" disabled={cleaning}>
            {cleaning ? "Scrubbing..." : "Clean the hog"}
          </button>
          <ActionMessage state={cleanState} />
        </form>
      </div>
    </section>
  );
}

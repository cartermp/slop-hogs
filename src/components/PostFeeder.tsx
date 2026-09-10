"use client";

import { useActionState } from "react";
import { feedPostAction, previewPostAction } from "@/app/post-actions";
import { FOOD_KINDS, FOOD_LABELS } from "@/lib/food";
import type { FeedFormState, PreviewFormState, PreviewSummary } from "@/lib/post-form";

const initialPreview: PreviewFormState = { status: "idle", message: "" };
const initialFeed: FeedFormState = { status: "idle", message: "" };

function FeedForm({ preview, requestId }: { preview: PreviewSummary; requestId: string }) {
  const [state, action, pending] = useActionState(feedPostAction, initialFeed);
  return (
    <form action={action} className="feed-form">
      <input type="hidden" name="sourceUri" value={preview.canonicalUri} />
      <input type="hidden" name="sourceCid" value={preview.cid} />
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor="food">Make this post taste like</label>
      <div>
        <select id="food" name="food" defaultValue="shitpost">
          {FOOD_KINDS.map(food => <option key={food} value={food}>{FOOD_LABELS[food]}</option>)}
        </select>
        <button className="auth-button" type="submit" disabled={pending}>
          {pending ? "Feeding..." : "Feed this post"}
        </button>
      </div>
      <p className="recipe-note">The flavor is your fictional game recipe, not a claim about who made the post.</p>
      {state.message && (
        <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
          {state.message}
          {state.status === "fed" && <> {state.mealsAvailable} meals remain.</>}
        </p>
      )}
    </form>
  );
}

export function PostFeeder() {
  const [state, action, pending] = useActionState(previewPostAction, initialPreview);
  return (
    <section className="post-feeder" aria-labelledby="post-feeder-title">
      <p className="eyebrow">Public post feeding</p>
      <h2 id="post-feeder-title">Paste something regrettable.</h2>
      <form action={action} className="preview-form">
        <label htmlFor="postUrl">Bluesky post URL</label>
        <div>
          <input
            id="postUrl"
            name="postUrl"
            type="url"
            placeholder="https://bsky.app/profile/.../post/..."
            required
            maxLength={2048}
          />
          <button className="auth-button" type="submit" disabled={pending}>
            {pending ? "Fetching..." : "Preview post"}
          </button>
        </div>
      </form>
      {state.message && (
        <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
          {state.message}
        </p>
      )}
      {state.status === "ready" && (
        <article className="post-preview">
          <header>
            <strong>{state.preview.authorDisplayName || state.preview.authorHandle}</strong>
            <span>@{state.preview.authorHandle}</span>
          </header>
          <p>{state.preview.text}</p>
          <a href={state.preview.postUrl} target="_blank" rel="noreferrer">Open original post</a>
          <FeedForm key={state.feedRequestId} preview={state.preview} requestId={state.feedRequestId} />
        </article>
      )}
    </section>
  );
}

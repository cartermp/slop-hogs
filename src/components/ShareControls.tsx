"use client";

import { useActionState, useState } from "react";
import { renderShareCardAction, updateShareSpeechAction } from "@/app/share-actions";
import { SHARE_SPEECH_MAX_LENGTH, type ShareActionFormState, type ShareEventView } from "@/lib/share";

const initialState: ShareActionFormState = { status: "idle", message: "" };

function ActionMessage({ state }: { state: ShareActionFormState }) {
  if (!state.message) return null;
  return (
    <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
      {state.message}
    </p>
  );
}

function ShareEventCard({ event, cardsEnabled }: { event: ShareEventView; cardsEnabled: boolean }) {
  const [saveState, saveAction, saving] = useActionState(updateShareSpeechAction, initialState);
  const [renderState, renderAction, rendering] = useActionState(renderShareCardAction, initialState);
  const [copied, setCopied] = useState(false);

  async function copyDraft() {
    const textarea = document.getElementById(`speech-${event.id}`);
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    await navigator.clipboard.writeText(textarea.value);
    setCopied(true);
  }

  return (
    <article className="share-event">
      <p className="specimen">{event.appearanceName}</p>
      <h3>{event.mutationName}</h3>
      <p>{event.eventText}</p>
      <form action={saveAction}>
        <input type="hidden" name="eventId" value={event.id} />
        <label htmlFor={`speech-${event.id}`}>Speech draft</label>
        <textarea
          id={`speech-${event.id}`}
          name="speech"
          defaultValue={event.speech}
          maxLength={SHARE_SPEECH_MAX_LENGTH}
          rows={4}
          required
        />
        <div className="share-actions">
          <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save draft"}</button>
          <button type="button" onClick={copyDraft}>{copied ? "Copied" : "Copy text"}</button>
        </div>
        <ActionMessage state={saveState} />
      </form>
      <div className="share-card-actions">
        {event.cardReady ? (
          <a href={`/share/${event.id}`}>Open public event and card</a>
        ) : (
          <form action={renderAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <button className="auth-button" type="submit" disabled={rendering || !cardsEnabled}>
              {rendering ? "Rendering..." : cardsEnabled ? "Render share card" : "Card rendering disabled"}
            </button>
            <ActionMessage state={renderState} />
          </form>
        )}
      </div>
    </article>
  );
}

export function ShareControls({
  events,
  cardsEnabled,
}: {
  events: ShareEventView[];
  cardsEnabled: boolean;
}) {
  return (
    <section className="share-controls" aria-labelledby="share-title">
      <p className="eyebrow">Speech and cards</p>
      <h2 id="share-title">Make the mutation everyone&apos;s problem.</h2>
      {events.length ? (
        <>
          <p className="note">Drafts are authored locally and editable. A rendered card is immutable and costs one daily render attempt.</p>
          <div className="share-grid">
            {events.map(event => <ShareEventCard key={event.id} event={event} cardsEnabled={cardsEnabled} />)}
          </div>
        </>
      ) : (
        <p className="note">Discover a mutation to unlock its speech draft and share event.</p>
      )}
    </section>
  );
}

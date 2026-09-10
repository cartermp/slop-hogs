"use client";

import { useActionState } from "react";
import {
  acceptGiftAction,
  declineGiftAction,
  setAccountBlockAction,
  setPenSettingAction,
} from "@/app/pen-actions";
import { FOOD_LABELS } from "@/lib/food";
import type { FoodKind } from "@/lib/game";
import type { SocialActionFormState } from "@/lib/social";

function Message({ state }: { state: SocialActionFormState }) {
  if (!state.message) return null;
  return (
    <p className={state.status === "error" ? "action-message action-error" : "action-message"} aria-live="polite">
      {state.message}
    </p>
  );
}

function SettingForm({
  setting,
  enabled,
  requestId,
  children,
}: {
  setting: "pen_public" | "gifts_enabled";
  enabled: boolean;
  requestId: string;
  children: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(setPenSettingAction, {
    status: "idle",
    message: "",
    requestId,
  } satisfies SocialActionFormState);
  return (
    <form action={action} className="pen-setting">
      <input type="hidden" name="requestId" value={state.requestId} />
      <input type="hidden" name="setting" value={setting} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <span>{children}</span>
      <button type="submit" disabled={pending}>{pending ? "Saving..." : enabled ? "Turn off" : "Turn on"}</button>
      <Message state={state} />
    </form>
  );
}

function PendingGiftCard({
  gift,
  acceptRequestId,
  declineRequestId,
  blockRequestId,
}: {
  gift: { id: string; senderDid: string; food: FoodKind; createdAt: string };
  acceptRequestId: string;
  declineRequestId: string;
  blockRequestId: string;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptGiftAction, {
    status: "idle", message: "", requestId: acceptRequestId,
  } satisfies SocialActionFormState);
  const [declineState, declineAction, declining] = useActionState(declineGiftAction, {
    status: "idle", message: "", requestId: declineRequestId,
  } satisfies SocialActionFormState);
  const [blockState, blockAction, blocking] = useActionState(setAccountBlockAction, {
    status: "idle", message: "", requestId: blockRequestId,
  } satisfies SocialActionFormState);
  return (
    <article className="gift-card">
      <p className="specimen">Visitor treat</p>
      <h3>{FOOD_LABELS[gift.food]}</h3>
      <p>From <code>{gift.senderDid}</code> on <time dateTime={gift.createdAt}>{gift.createdAt.slice(0, 10)}</time>.</p>
      <div className="gift-actions">
        <form action={acceptAction}>
          <input type="hidden" name="giftId" value={gift.id} />
          <input type="hidden" name="requestId" value={acceptState.requestId} />
          <button className="auth-button" type="submit" disabled={accepting}>Accept as meal</button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="giftId" value={gift.id} />
          <input type="hidden" name="requestId" value={declineState.requestId} />
          <button type="submit" disabled={declining}>Discard</button>
        </form>
        <form action={blockAction}>
          <input type="hidden" name="did" value={gift.senderDid} />
          <input type="hidden" name="blocked" value="true" />
          <input type="hidden" name="requestId" value={blockState.requestId} />
          <button type="submit" disabled={blocking}>Block sender</button>
        </form>
      </div>
      <Message state={acceptState.status !== "idle" ? acceptState : declineState.status !== "idle" ? declineState : blockState} />
    </article>
  );
}

function UnblockForm({ did, requestId }: { did: string; requestId: string }) {
  const [state, action, pending] = useActionState(setAccountBlockAction, {
    status: "idle", message: "", requestId,
  } satisfies SocialActionFormState);
  return (
    <form action={action} className="blocked-account">
      <input type="hidden" name="did" value={did} />
      <input type="hidden" name="blocked" value="false" />
      <input type="hidden" name="requestId" value={state.requestId} />
      <code>{did}</code>
      <button type="submit" disabled={pending}>{pending ? "Saving..." : "Unblock"}</button>
      <Message state={state} />
    </form>
  );
}

export function PenControls({
  pen,
  requestIds,
}: {
  pen: {
    penId: string;
    isPublic: boolean;
    giftsEnabled: boolean;
    pendingGifts: Array<{ id: string; senderDid: string; food: FoodKind; createdAt: string }>;
    blockedDids: string[];
  };
  requestIds: {
    visibility: string;
    gifts: string;
    block: string;
    accept: string[];
    decline: string[];
    giftBlock: string[];
    unblock: string[];
  };
}) {
  const [blockState, blockAction, blocking] = useActionState(setAccountBlockAction, {
    status: "idle", message: "", requestId: requestIds.block,
  } satisfies SocialActionFormState);
  const publicPath = `/pen/${pen.penId}`;
  return (
    <section className="pen-controls" aria-labelledby="pen-controls-title">
      <p className="eyebrow">Public pen</p>
      <h2 id="pen-controls-title">Control the gate.</h2>
      <div className="pen-settings">
        <SettingForm setting="pen_public" enabled={pen.isPublic} requestId={requestIds.visibility}>
          <strong>Public page</strong>
          <small>{pen.isPublic ? "Anyone with the link can view this hog." : "The public URL returns not found."}</small>
        </SettingForm>
        <SettingForm setting="gifts_enabled" enabled={pen.giftsEnabled} requestId={requestIds.gifts}>
          <strong>Visitor treats</strong>
          <small>{pen.giftsEnabled ? "Signed-in visitors may queue bounded treats." : "No new treats can be sent."}</small>
        </SettingForm>
      </div>
      {pen.isPublic && <a className="public-pen-link" href={publicPath}>Open your public pen</a>}

      <h3 className="gift-heading">Pending treats ({pen.pendingGifts.length})</h3>
      {pen.pendingGifts.length ? (
        <div className="gift-grid">
          {pen.pendingGifts.map((gift, index) => (
            <PendingGiftCard
              key={gift.id}
              gift={gift}
              acceptRequestId={requestIds.accept[index]}
              declineRequestId={requestIds.decline[index]}
              blockRequestId={requestIds.giftBlock[index]}
            />
          ))}
        </div>
      ) : <p className="note">The treat basket is empty.</p>}

      <h3 className="gift-heading">Blocked accounts</h3>
      <form action={blockAction} className="block-form">
        <input type="hidden" name="blocked" value="true" />
        <input type="hidden" name="requestId" value={blockState.requestId} />
        <label htmlFor="blocked-did">Block a Slop Hogs account DID</label>
        <div>
          <input id="blocked-did" name="did" placeholder="did:plc:..." required maxLength={2048} />
          <button type="submit" disabled={blocking}>{blocking ? "Blocking..." : "Block"}</button>
        </div>
        <Message state={blockState} />
      </form>
      {pen.blockedDids.map((did, index) => (
        <UnblockForm key={did} did={did} requestId={requestIds.unblock[index]} />
      ))}
    </section>
  );
}

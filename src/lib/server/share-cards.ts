import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { appearanceForState, type HogAppearance } from "../../components/hog/appearance.ts";
import { MUTATION_CATALOG, parseGameState, type GameResult, type MutationId } from "../game.ts";
import {
  createSpeechDraft,
  parseShareSpeech,
  type ShareEventView,
} from "../share.ts";
import type { CostPolicy } from "../cost-policy.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { transaction } from "./database.ts";
import { refreshOperationalStatusForPool } from "./operations.ts";
import {
  renderShareCardPng,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  type ShareCardRenderInput,
} from "./share-card-renderer.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionToken = /^[0-9a-f]{64}$/;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const renderStaleSeconds = 30;
const mutationIds = new Set(MUTATION_CATALOG.map(entry => entry.id));
let renderBusy = false;

export class CardLimitError extends Error {}
export class CardUnavailableError extends Error {}
export class CardRenderBusyError extends Error {}

type CardPolicy = {
  limits: Pick<CostPolicy["limits"],
    "cardsPerAccountPerDay" | "cardsGlobalPerDay" | "cardMaxBytes" |
    "cardStorageMaxBytes" | "externalRequestTimeoutMs">;
  database: CostPolicy["database"];
  features: Pick<CostPolicy["features"], "cardRendering" | "readOnlyMode">;
};

type EventRow = {
  id: string;
  mutation: MutationId;
  event_text: string;
  state: unknown;
  speech: string;
  render_status: "not_requested" | "rendering" | "failed" | "ready";
  created_at: Date;
  card_ready: boolean;
};

export type PublicShareEvent = ShareEventView & { appearance: HogAppearance };
export type StoredShareCard = { png: Buffer; createdAt: Date };

function selectedPolicy(policy?: CardPolicy): CardPolicy {
  return policy ?? loadCostPolicy();
}

function mutationName(mutation: MutationId): string {
  const name = MUTATION_CATALOG.find(entry => entry.id === mutation)?.name;
  if (!name) throw new Error("Share event has an unknown mutation");
  return name;
}

function mapEvent(row: EventRow): ShareEventView {
  const state = parseGameState(row.state);
  return {
    id: row.id,
    mutation: row.mutation,
    mutationName: mutationName(row.mutation),
    eventText: row.event_text,
    speech: row.speech,
    appearanceName: appearanceForState(state).name,
    cardReady: row.card_ready,
  };
}

function validMutationEvent(value: unknown): value is { type: "mutation_discovered"; mutation: MutationId; text: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return event.type === "mutation_discovered"
    && typeof event.mutation === "string"
    && mutationIds.has(event.mutation as MutationId)
    && typeof event.text === "string"
    && event.text.length > 0
    && event.text.length <= 500;
}

async function insertMissingEvents(pool: Pool, token: string): Promise<void> {
  const actions = await pool.query<{
    hog_id: string;
    request_id: string;
    result: GameResult;
  }>(
    `SELECT action.hog_id, action.request_id, action.result
       FROM app_sessions session
       JOIN hog_lives hog ON hog.owner_did=session.owner_did
       JOIN hog_actions action ON action.hog_id=hog.id
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(action.result->'events') WITH ORDINALITY AS candidate(value, ordinal)
            WHERE candidate.value->>'type'='mutation_discovered'
              AND NOT EXISTS (
                SELECT 1 FROM share_events event
                 WHERE event.hog_id=action.hog_id
                   AND event.action_request_id=action.request_id
                   AND event.event_index=candidate.ordinal - 1
              )
         )
       ORDER BY action.created_at, action.request_id
    `,
    [hash(token)],
  );
  if (!actions.rowCount) return;
  const policy = loadCostPolicy();
  const controls = await refreshOperationalStatusForPool(pool, {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  });
  if (controls.readOnly) return;
  for (const action of actions.rows) {
    const state = parseGameState(action.result.state);
    for (const [eventIndex, event] of action.result.events.entries()) {
      if (!validMutationEvent(event)) continue;
      const speech = createSpeechDraft(state, event.mutation, `${action.request_id}:${eventIndex}`);
      await pool.query(
        `INSERT INTO share_events(
           hog_id, action_request_id, event_index, mutation, event_text, state, speech
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (hog_id, action_request_id, event_index) DO NOTHING`,
        [action.hog_id, action.request_id, eventIndex, event.mutation, event.text, state, speech],
      );
    }
  }
}

export async function getShareEvents(pool: Pool, token: string): Promise<ShareEventView[]> {
  if (!sessionToken.test(token)) return [];
  await insertMissingEvents(pool, token);
  const result = await pool.query<EventRow>(
    `SELECT event.id, event.mutation, event.event_text, event.state, event.speech,
            event.render_status, event.created_at, card.event_id IS NOT NULL AS card_ready
       FROM app_sessions session
       JOIN hog_lives hog ON hog.owner_did=session.owner_did
       JOIN share_events event ON event.hog_id=hog.id
       LEFT JOIN share_cards card ON card.event_id=event.id
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp()
      ORDER BY event.created_at DESC, event.id
      LIMIT 20`,
    [hash(token)],
  );
  return result.rows.map(mapEvent);
}

export async function getPublicShareEvent(pool: Pool, eventId: string): Promise<PublicShareEvent | null> {
  if (!uuid.test(eventId)) return null;
  const result = await pool.query<EventRow>(
    `SELECT event.id, event.mutation, event.event_text, event.state, event.speech,
            event.render_status, event.created_at, card.event_id IS NOT NULL AS card_ready
       FROM share_events event
       JOIN hog_lives hog ON hog.id=event.hog_id
       JOIN accounts account ON account.did=hog.owner_did AND account.pen_public
       LEFT JOIN share_cards card ON card.event_id=event.id
      WHERE event.id=$1`,
    [eventId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { ...mapEvent(row), appearance: appearanceForState(parseGameState(row.state)) };
}

export async function getStoredShareCard(pool: Pool, eventId: string): Promise<StoredShareCard | null> {
  if (!uuid.test(eventId)) return null;
  const result = await pool.query<{ png: Buffer; created_at: Date }>(
    `SELECT card.png, card.created_at
       FROM share_cards card
       JOIN share_events event ON event.id=card.event_id
       JOIN hog_lives hog ON hog.id=event.hog_id
       JOIN accounts account ON account.did=hog.owner_did AND account.pen_public
      WHERE card.event_id=$1`,
    [eventId],
  );
  return result.rowCount ? { png: result.rows[0].png, createdAt: result.rows[0].created_at } : null;
}

async function authenticatedEvent(
  client: PoolClient,
  token: string,
  eventId: string,
  lock: boolean,
): Promise<(EventRow & { owner_did: string; render_attempts: number; render_started_at: Date | null }) | null> {
  const result = await client.query<EventRow & {
    owner_did: string;
    render_attempts: number;
    render_started_at: Date | null;
  }>(
    `SELECT event.id, event.mutation, event.event_text, event.state, event.speech,
            event.render_status, event.render_attempts, event.render_started_at,
            event.created_at, session.owner_did, card.event_id IS NOT NULL AS card_ready
       FROM app_sessions session
       JOIN hog_lives hog ON hog.owner_did=session.owner_did
       JOIN share_events event ON event.hog_id=hog.id
       LEFT JOIN share_cards card ON card.event_id=event.id
      WHERE session.token_hash=$1 AND session.expires_at > clock_timestamp() AND event.id=$2
      ${lock ? "FOR UPDATE OF event" : ""}`,
    [hash(token), eventId],
  );
  return result.rows[0] ?? null;
}

export async function updateShareSpeech(
  pool: Pool,
  token: string,
  eventId: string,
  input: unknown,
): Promise<string> {
  if (!sessionToken.test(token) || !uuid.test(eventId)) throw new Error("Unauthorized");
  const speech = parseShareSpeech(input);
  const policy = loadCostPolicy();
  const controls = await refreshOperationalStatusForPool(pool, {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  });
  if (controls.readOnly) throw new CardUnavailableError("Slop Hogs is temporarily read-only");
  const result = await pool.query(
    `UPDATE share_events event
        SET speech=$3
       FROM hog_lives hog, app_sessions session
      WHERE event.id=$2 AND hog.id=event.hog_id
        AND session.owner_did=hog.owner_did
        AND session.token_hash=$1 AND session.expires_at > clock_timestamp()
      RETURNING event.id`,
    [hash(token), eventId, speech],
  );
  if (!result.rowCount) throw new Error("Unauthorized");
  return speech;
}

async function reserveDailyCounter(
  client: PoolClient,
  table: "card_account_daily" | "card_global_daily",
  ownerDid: string,
  limit: number,
): Promise<void> {
  const account = table === "card_account_daily";
  const result = await client.query(
    account
      ? `INSERT INTO card_account_daily(bucket_start, owner_did, cards)
         VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date,$1,1)
         ON CONFLICT (bucket_start, owner_did) DO UPDATE
           SET cards=card_account_daily.cards + 1
           WHERE card_account_daily.cards < $2
         RETURNING cards`
      : `INSERT INTO card_global_daily(bucket_start, cards)
         VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date,1)
         ON CONFLICT (bucket_start) DO UPDATE
           SET cards=card_global_daily.cards + 1
           WHERE card_global_daily.cards < $1
         RETURNING cards`,
    account ? [ownerDid, limit] : [limit],
  );
  if (!result.rowCount) throw new CardLimitError("The daily share-card allowance has been used");
}

type ReservedRender = {
  existing: boolean;
  attempt?: number;
  input?: ShareCardRenderInput;
};

async function reserveRender(
  pool: Pool,
  token: string,
  eventId: string,
  policy: CardPolicy,
): Promise<ReservedRender> {
  return transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(734007)");
    const event = await authenticatedEvent(client, token, eventId, true);
    if (!event) throw new Error("Unauthorized");
    if (event.card_ready) return { existing: true };
    if (
      event.render_status === "rendering"
      && event.render_started_at
      && event.render_started_at.getTime() > Date.now() - renderStaleSeconds * 1_000
    ) {
      throw new CardRenderBusyError("This card is already rendering");
    }
    const storage = await client.query<{ bytes: string; active: string }>(
      `SELECT
         COALESCE((SELECT sum(byte_length) FROM share_cards), 0)::text AS bytes,
         (SELECT count(*) FROM share_events
           WHERE render_status='rendering'
             AND render_started_at > clock_timestamp() - ($1 * interval '1 second')
             AND id <> $2)::text AS active`,
      [renderStaleSeconds, eventId],
    );
    const reservedBytes = Number(storage.rows[0].bytes)
      + Number(storage.rows[0].active) * policy.limits.cardMaxBytes;
    if (reservedBytes + policy.limits.cardMaxBytes > policy.limits.cardStorageMaxBytes) {
      throw new CardLimitError("Share-card storage is full");
    }
    await reserveDailyCounter(
      client,
      "card_account_daily",
      event.owner_did,
      policy.limits.cardsPerAccountPerDay,
    );
    await reserveDailyCounter(
      client,
      "card_global_daily",
      event.owner_did,
      policy.limits.cardsGlobalPerDay,
    );
    const attempt = event.render_attempts + 1;
    await client.query(
      `UPDATE share_events
          SET render_status='rendering', render_attempts=$2, render_started_at=clock_timestamp()
        WHERE id=$1`,
      [eventId, attempt],
    );
    const state = parseGameState(event.state);
    return {
      existing: false,
      attempt,
      input: {
        appearance: appearanceForState(state),
        mutationName: mutationName(event.mutation),
        speech: event.speech,
      },
    };
  });
}

async function failRender(pool: Pool, eventId: string, attempt: number): Promise<void> {
  await pool.query(
    `UPDATE share_events
        SET render_status='failed', render_started_at=NULL
      WHERE id=$1 AND render_status='rendering' AND render_attempts=$2`,
    [eventId, attempt],
  );
}

export async function requestShareCard(
  pool: Pool,
  token: string,
  eventId: string,
  policyInput?: CardPolicy,
  renderer: (input: ShareCardRenderInput, timeoutMs: number) => Promise<Buffer> = renderShareCardPng,
): Promise<void> {
  if (!sessionToken.test(token) || !uuid.test(eventId)) throw new Error("Unauthorized");
  const initial = await transaction(pool, client => authenticatedEvent(client, token, eventId, false));
  if (!initial) throw new Error("Unauthorized");
  if (initial.card_ready) return;
  const policy = selectedPolicy(policyInput);
  if (!policy.features.cardRendering) throw new CardUnavailableError("Share-card rendering is disabled");
  if (renderBusy) throw new CardRenderBusyError("Another share card is rendering. Try again shortly.");
  renderBusy = true;
  let reservation: ReservedRender | null = null;
  try {
    const controls = await refreshOperationalStatusForPool(pool, {
      database: policy.database,
      readOnlyMode: policy.features.readOnlyMode,
    });
    if (controls.cardsBlocked) throw new CardUnavailableError("New share cards are temporarily blocked");
    reservation = await reserveRender(pool, token, eventId, policy);
    if (reservation.existing) return;
    const png = await renderer(reservation.input!, policy.limits.externalRequestTimeoutMs);
    if (!png.length || png.length > policy.limits.cardMaxBytes) {
      throw new CardLimitError("The rendered card exceeds its size limit");
    }
    await transaction(pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(734007)");
      const current = await client.query<{ render_status: string; render_attempts: number }>(
        "SELECT render_status, render_attempts FROM share_events WHERE id=$1 FOR UPDATE",
        [eventId],
      );
      if (
        !current.rowCount
        || current.rows[0].render_status !== "rendering"
        || current.rows[0].render_attempts !== reservation!.attempt
      ) {
        throw new CardRenderBusyError("A newer render attempt replaced this one");
      }
      await client.query(
        `INSERT INTO share_cards(event_id, png, byte_length, width, height)
         VALUES ($1,$2,$3,$4,$5)`,
        [eventId, png, png.length, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT],
      );
      await client.query(
        "UPDATE share_events SET render_status='ready', render_started_at=NULL WHERE id=$1",
        [eventId],
      );
    });
  } catch (error) {
    if (reservation?.attempt) await failRender(pool, eventId, reservation.attempt);
    if (
      error instanceof CardLimitError
      || error instanceof CardUnavailableError
      || error instanceof CardRenderBusyError
      || (error instanceof Error && error.message === "Unauthorized")
    ) throw error;
    console.error(`Share-card render failed: ${error instanceof Error ? error.message : "unknown error"}`);
    throw new CardUnavailableError("The share card could not be rendered. Try again.");
  } finally {
    renderBusy = false;
  }
}

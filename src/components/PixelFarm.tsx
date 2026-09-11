"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AchievementCabinet } from "@/components/AchievementCabinet";
import { FeedbackLinks } from "@/components/FeedbackLinks";
import { ACHIEVEMENT_BY_ID } from "@/lib/achievements";
import {
  FARM_HEIGHT,
  FARM_WIDTH,
  MAX_HEALTH,
  POPPING_MASS,
  SLOP_CATALOG,
  STARTING_MASS,
  battleRange,
  hogDiameter,
  psychosisLevel,
  type BattleMove,
  type FarmAction,
  type FarmActionResult,
  type FarmEvent,
  type FarmPlayer,
  type FarmSnapshot,
} from "@/lib/farm-game";

type Direction = "up" | "down" | "left" | "right";

const movementKeys: ReadonlyMap<string, Direction> = new Map([
  ["w", "up"],
  ["arrowup", "up"],
  ["s", "down"],
  ["arrowdown", "down"],
  ["a", "left"],
  ["arrowleft", "left"],
  ["d", "right"],
  ["arrowright", "right"],
] as const);

function isFarmResult(value: unknown): value is FarmActionResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (!result.snapshot || typeof result.snapshot !== "object" || !Array.isArray(result.events)) return false;
  const snapshot = result.snapshot as Record<string, unknown>;
  return typeof snapshot.serverNowMs === "number"
    && Array.isArray(snapshot.players)
    && Array.isArray(snapshot.slop)
    && Boolean(snapshot.achievements);
}

function PixelHog({
  player,
  targeted,
  onTarget,
}: {
  player: FarmPlayer;
  targeted: boolean;
  onTarget?: () => void;
}) {
  const diameter = hogDiameter(player.mass);
  const effectLabel = Object.values(SLOP_CATALOG)
    .find(definition => definition.effect === player.effect)?.effectLabel;
  if (player.status !== "alive") {
    const defeated = player.status === "defeated";
    return (
      <div className={`farm-player ${defeated ? "defeated-player" : "popped-player"}`} style={{
        left: `${player.x / FARM_WIDTH * 100}%`,
        top: `${player.y / FARM_HEIGHT * 100}%`,
        zIndex: Math.round(player.y),
      }}>
        <span className="player-name">{player.name}{player.isYou ? " (YOU)" : ""}</span>
        <div className="pixel-pop" aria-label={`${player.name} ${defeated ? "was defeated" : "popped"}`}>
          <i /><i /><i /><i /><b>{defeated ? "KO!" : "POP!"}</b>
        </div>
      </div>
    );
  }
  const className = `farm-player${player.isYou ? " current-player" : ""}${targeted ? " targeted-player" : ""}${player.effect ? ` effect-${player.effect}` : ""}`;
  const style = {
    left: `${player.x / FARM_WIDTH * 100}%`,
    top: `${player.y / FARM_HEIGHT * 100}%`,
    zIndex: Math.round(player.y),
    width: diameter,
    height: diameter * 0.72,
  };
  const hog = (
    <>
      <span className="hog-health" aria-label={`${player.health} health`}>
        <i style={{ width: `${player.health / MAX_HEALTH * 100}%` }} />
      </span>
      <span className="player-name">{player.name}{player.isYou ? " (YOU)" : ""}</span>
      {effectLabel && <span className="effect-bubble">{effectLabel}</span>}
      <div className={`pixel-hog facing-${player.facing}`}>
        <i className="hog-tail-pixel" />
        <i className="hog-ear-pixel" />
        <i className="hog-body-pixel" />
        <i className="hog-eye-pixel" />
        <i className="hog-snout-pixel" />
        <i className="hog-leg-pixel leg-one" />
        <i className="hog-leg-pixel leg-two" />
      </div>
    </>
  );
  if (onTarget) {
    return (
      <button
        type="button"
        className={`${className} targetable-player`}
        style={style}
        aria-label={`Target ${player.name}`}
        aria-pressed={targeted}
        onClick={onTarget}
      >
        {hog}
      </button>
    );
  }
  return (
    <div className={className} style={style}>
      {hog}
    </div>
  );
}

function eventMessage(event: FarmEvent): string {
  if (event.type === "slop_eaten") {
    return `${SLOP_CATALOG[event.kind].label}: +${event.massGained} mass / +${event.pointsGained} points`;
  }
  if (event.type === "battle_attack") {
    const psychosis = event.psychosisDelta > 0
      ? `+${event.psychosisDelta} psychosis`
      : `${Math.abs(event.psychosisDelta)} psychosis released`;
    return `${event.move.toUpperCase()} hit ${event.targetName} for ${event.damage}. ${psychosis}.${event.targetDefeated ? " KNOCKOUT!" : ` ${event.targetHealth} HP left.`}`;
  }
  if (event.type === "psychosis_released") {
    return `FART released ${event.amount} psychosis. No target required.`;
  }
  if (event.type === "achievements_unlocked") {
    const names = event.achievementIds
      .map(id => ACHIEVEMENT_BY_ID.get(id)?.title)
      .filter((title): title is string => Boolean(title));
    return names.length === 1
      ? `ACHIEVEMENT UNLOCKED: ${names[0]}`
      : `${names.length} ACHIEVEMENTS UNLOCKED: ${names.join(" / ")}`;
  }
  if (event.type === "restarted") return "Fresh hog deployed. Resume battle.";
  return "CRITICAL MASS REACHED";
}

export function PixelFarm() {
  const [snapshot, setSnapshot] = useState<FarmSnapshot | null>(null);
  const [notice, setNotice] = useState("Select a hog, close the gap, then Bite or Fart.");
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const keys = useRef(new Set<Direction>());
  const requestInFlight = useRef(false);
  const latestServerTime = useRef(0);

  const acceptResult = useCallback((result: FarmActionResult, showEvents: boolean) => {
    if (result.snapshot.serverNowMs >= latestServerTime.current) {
      latestServerTime.current = result.snapshot.serverNowMs;
      setSnapshot(result.snapshot);
    }
    if (showEvents && result.events.length) {
      setNotice(eventMessage(result.events.at(-1)!));
    }
    if (result.snapshot.players.find(player => player.isYou)?.status !== "alive") {
      keys.current.clear();
    }
    setError(null);
  }, []);

  const requestFarm = useCallback(async (action?: FarmAction) => {
    const response = await fetch("/api/farm", action ? {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(action),
    } : {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isFarmResult(payload)) {
      const message = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as { error: string }).error
        : "Lost contact with the farm";
      throw new Error(message);
    }
    acceptResult(payload, Boolean(action));
  }, [acceptResult]);

  useEffect(() => {
    let active = true;
    requestFarm().catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : "The farm failed to load");
    });
    const poll = window.setInterval(() => {
      requestFarm().catch(failure => {
        if (active) setError(failure instanceof Error ? failure.message : "The farm failed to sync");
      });
    }, 900);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [requestFarm]);

  useEffect(() => {
    const changeKey = (event: KeyboardEvent, pressed: boolean) => {
      const direction = movementKeys.get(event.key.toLowerCase());
      if (!direction) return;
      event.preventDefault();
      if (pressed) keys.current.add(direction);
      else keys.current.delete(direction);
    };
    const down = (event: KeyboardEvent) => changeKey(event, true);
    const up = (event: KeyboardEvent) => changeKey(event, false);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const movement = window.setInterval(() => {
      if (requestInFlight.current || keys.current.size === 0) return;
      const dx = (keys.current.has("right") ? 1 : 0) - (keys.current.has("left") ? 1 : 0);
      const dy = (keys.current.has("down") ? 1 : 0) - (keys.current.has("up") ? 1 : 0);
      if (dx === 0 && dy === 0) return;
      requestInFlight.current = true;
      requestFarm({ type: "move", dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 })
        .catch(failure => setError(failure instanceof Error ? failure.message : "Movement failed"))
        .finally(() => { requestInFlight.current = false; });
    }, 120);
    return () => window.clearInterval(movement);
  }, [requestFarm]);

  const ownHog = snapshot?.players.find(player => player.isYou) ?? null;
  const opponents = useMemo(
    () => snapshot?.players.filter(player => !player.isYou && player.status === "alive") ?? [],
    [snapshot],
  );
  const selectedTarget = opponents.find(player => player.id === targetId)
    ?? (ownHog ? opponents.reduce<FarmPlayer | null>((nearest, player) => {
      if (!nearest) return player;
      const distance = Math.hypot(player.x - ownHog.x, player.y - ownHog.y);
      const nearestDistance = Math.hypot(nearest.x - ownHog.x, nearest.y - ownHog.y);
      return distance < nearestDistance ? player : nearest;
    }, null) : null);
  const massPercent = ownHog ? psychosisLevel(ownHog.mass) * 100 : 0;
  const targetDistance = ownHog && selectedTarget
    ? Math.hypot(selectedTarget.x - ownHog.x, selectedTarget.y - ownHog.y)
    : Infinity;
  const canBite = Boolean(
    ownHog
    && selectedTarget
    && ownHog.status === "alive"
    && targetDistance <= battleRange("bite", ownHog, selectedTarget),
  );
  const canFartHit = Boolean(
    ownHog
    && selectedTarget
    && ownHog.status === "alive"
    && targetDistance <= battleRange("fart", ownHog, selectedTarget),
  );

  function setPad(direction: Direction, pressed: boolean) {
    if (pressed) keys.current.add(direction);
    else keys.current.delete(direction);
  }

  async function restart() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    keys.current.clear();
    try {
      await requestFarm({ type: "restart" });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Restart failed");
    } finally {
      requestInFlight.current = false;
    }
  }

  async function attack(move: BattleMove) {
    if (requestInFlight.current || !ownHog || ownHog.status !== "alive") return;
    const target = selectedTarget;
    let action: FarmAction;
    if (move === "bite") {
      if (!canBite || !target) return;
      action = { type: "bite", targetId: target.id };
    } else {
      action = canFartHit && target
        ? { type: "fart", targetId: target.id }
        : { type: "fart" };
    }
    requestInFlight.current = true;
    keys.current.clear();
    try {
      await requestFarm(action);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Attack failed");
    } finally {
      requestInFlight.current = false;
    }
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div>
          <p className="pixel-kicker">ONLINE // BATTLE FARM 01</p>
          <h1>SLOP<br /><span>HOGS</span></h1>
        </div>
        <div className="game-status">
          <span><i className="online-dot" /> {Math.max(1, snapshot?.players.length ?? 1)} HOGS ONLINE</span>
          <form action="/oauth/logout" method="post">
            <button type="submit">[ SIGN OUT ]</button>
          </form>
          <FeedbackLinks variant="game" />
        </div>
      </header>

      <section className="game-console" aria-label="Slop Hogs multiplayer battle">
        <div className="hud">
          <div className="hud-stat"><small>HOG</small><strong>{ownHog?.name ?? "LOADING..."}</strong></div>
          <div className="hud-stat"><small>KNOCKOUTS</small><strong>{ownHog?.knockouts ?? 0}</strong></div>
          <div className="hud-stat"><small>SCORE</small><strong>{String(ownHog?.score ?? 0).padStart(6, "0")}</strong></div>
          <div className="health-meter">
            <small>HEALTH</small>
            <div><i style={{ width: `${ownHog?.health ?? MAX_HEALTH}%` }} /></div>
            <strong>{ownHog?.health ?? MAX_HEALTH}</strong>
          </div>
          <div className="mass-meter">
            <small>PSYCHOSIS</small>
            <div><i style={{ width: `${massPercent}%` }} /></div>
            <strong>{ownHog?.mass ?? STARTING_MASS} / {POPPING_MASS}</strong>
          </div>
        </div>

        <div className="farm-viewport">
          <div className="farm-world">
            <div className="crop-field field-one" aria-hidden="true" />
            <div className="crop-field field-two" aria-hidden="true" />
            <div className="farm-path path-horizontal" aria-hidden="true" />
            <div className="farm-path path-vertical" aria-hidden="true" />
            <div className="pixel-pond" aria-hidden="true"><i /><i /><i /></div>
            <div className="pigsty" aria-hidden="true"><b>PIGSTY.EXE</b><i /></div>
            <div className="mud-pen" aria-hidden="true"><b>COMMUNAL PEN</b></div>
            <div className="hay-bale hay-one" aria-hidden="true" />
            <div className="hay-bale hay-two" aria-hidden="true" />
            <div className="farm-fence fence-top" aria-hidden="true" />
            <div className="farm-fence fence-bottom" aria-hidden="true" />

            {snapshot?.slop.map(item => (
              <div
                className={`slop-pickup slop-${item.kind}`}
                key={item.id}
                style={{ left: `${item.x / FARM_WIDTH * 100}%`, top: `${item.y / FARM_HEIGHT * 100}%` }}
                title={`${SLOP_CATALOG[item.kind].label}: ${SLOP_CATALOG[item.kind].description}`}
              >
                <i>{SLOP_CATALOG[item.kind].shortLabel}</i>
              </div>
            ))}
            {snapshot?.players.map(player => (
              <PixelHog
                key={player.id}
                player={player}
                targeted={player.id === selectedTarget?.id}
                onTarget={!player.isYou && player.status === "alive"
                  ? () => setTargetId(player.id)
                  : undefined}
              />
            ))}

            {!snapshot && <div className="farm-loading">DIALING THE SLOP MAINFRAME...</div>}
            {ownHog && ownHog.status !== "alive" && (
              <div className="pop-overlay" role="dialog" aria-modal="true" aria-labelledby="pop-title">
                <p>!!! SYSTEM FAILURE !!!</p>
                <h2 id="pop-title">
                  {ownHog.status === "popped"
                    ? <>SLOP HOG POPPED<br />DUE TO AI PSYCHOSIS</>
                    : <>SLOP HOG DEFEATED<br />IN BATTLE</>}
                </h2>
                <div>
                  FINAL SCORE: {String(ownHog.score).padStart(6, "0")}<br />
                  KNOCKOUTS: {ownHog.knockouts}
                </div>
                <button type="button" onClick={restart} disabled={requestInFlight.current}>
                  [ DEPLOY FRESH HOG ]
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="console-footer">
          <div className="game-message" aria-live="polite">
            <span>BATTLE FEED:</span> {error ? `ERROR: ${error}` : notice}
          </div>
          <div className="battle-controls" aria-label="Battle controls">
            <span>TARGET: {selectedTarget?.name ?? "NO HOG"}</span>
            <button
              type="button"
              title="Heavy hit; adds 7 psychosis"
              onClick={() => attack("bite")}
              disabled={!canBite || requestInFlight.current}
            >
              [ BITE +7 PSI ]
            </button>
            <button
              type="button"
              title="Always releases up to 10 psychosis; also hits a target in range"
              onClick={() => attack("fart")}
              disabled={!ownHog || ownHog.status !== "alive" || requestInFlight.current}
            >
              [ FART -10 PSI ]
            </button>
          </div>
          <div className="controls-copy">
            <span>MOVE</span> WASD / ARROW KEYS
          </div>
          <div className="d-pad" aria-label="Touch movement controls">
            <button
              type="button"
              aria-label="Move up"
              onPointerDown={() => setPad("up", true)}
              onPointerUp={() => setPad("up", false)}
              onPointerCancel={() => setPad("up", false)}
            >▲</button>
            <button
              type="button"
              aria-label="Move left"
              onPointerDown={() => setPad("left", true)}
              onPointerUp={() => setPad("left", false)}
              onPointerCancel={() => setPad("left", false)}
            >◀</button>
            <button
              type="button"
              aria-label="Move down"
              onPointerDown={() => setPad("down", true)}
              onPointerUp={() => setPad("down", false)}
              onPointerCancel={() => setPad("down", false)}
            >▼</button>
            <button
              type="button"
              aria-label="Move right"
              onPointerDown={() => setPad("right", true)}
              onPointerUp={() => setPad("right", false)}
              onPointerCancel={() => setPad("right", false)}
            >▶</button>
          </div>
        </div>
      </section>

      {snapshot && (
        <AchievementCabinet
          playerName={ownHog?.name ?? "UNKNOWN HOG"}
          state={snapshot.achievements}
        />
      )}

      <section className="slop-legend" aria-labelledby="slop-guide-title">
        <div>
          <p className="pixel-kicker">FIELD MANUAL</p>
          <h2 id="slop-guide-title">KNOW YOUR SLOP</h2>
        </div>
        {Object.entries(SLOP_CATALOG).map(([kind, item]) => (
          <article key={kind}>
            <i className={`legend-sprite slop-${kind}`}>{item.shortLabel}</i>
            <div>
              <strong>{item.label}</strong>
              <span>{item.description} +{item.mass} psychosis. {item.battleBonus}.</span>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

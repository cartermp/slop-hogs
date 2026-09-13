"use client";

import {
  SINGLE_PLAYER_ACHIEVEMENTS,
  formatSinglePlayerAchievementProgress,
  singlePlayerAchievementShareUrl,
  singlePlayerAchievementValue,
} from "@/lib/single-player-achievements";
import type { SinglePlayerAchievementState } from "@/lib/single-player";

export function SinglePlayerAchievementCabinet({
  canShareToBluesky,
  playerName,
  state,
}: {
  canShareToBluesky: boolean;
  playerName: string;
  state: SinglePlayerAchievementState;
}) {
  const unlocked = new Set(state.unlocks.map(entry => entry.id));

  return (
    <section className="achievement-cabinet solo-achievement-cabinet" aria-labelledby="solo-achievement-title">
      <div className="achievement-heading">
        <div>
          <p className="pixel-kicker">SOLO GLORY // PERSISTENT RECORD</p>
          <h2 id="solo-achievement-title">SINGLE-PLAYER ACHIEVEMENTS</h2>
        </div>
        <strong>{String(unlocked.size).padStart(2, "0")} / {SINGLE_PLAYER_ACHIEVEMENTS.length} UNLOCKED</strong>
      </div>
      <div className="achievement-grid solo-achievement-grid">
        {SINGLE_PLAYER_ACHIEVEMENTS.map(achievement => {
          const isUnlocked = unlocked.has(achievement.id);
          const progress = singlePlayerAchievementValue(achievement, state.progress);
          return (
            <article
              className={`achievement-card tier-${achievement.tier}${isUnlocked ? " unlocked" : " locked"}`}
              key={achievement.id}
            >
              <div className="achievement-badge" aria-hidden="true">
                {isUnlocked ? "1P" : "??"}
              </div>
              <div className="achievement-copy">
                <span>{achievement.category} // {achievement.tier}</span>
                <h3>{achievement.title}</h3>
                <p>{achievement.description}</p>
                <div className="achievement-progress">
                  <i style={{ width: `${Math.min(100, progress / achievement.goal * 100)}%` }} />
                </div>
                <small>{formatSinglePlayerAchievementProgress(progress, achievement)}</small>
              </div>
              {isUnlocked && canShareToBluesky && (
                <a
                  className="achievement-share"
                  href={singlePlayerAchievementShareUrl(achievement, playerName)}
                  target="_blank"
                  rel="noreferrer"
                >
                  SHARE TO BLUESKY
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

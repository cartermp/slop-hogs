"use client";

import {
  ACHIEVEMENTS,
  achievementShareUrl,
  achievementValue,
  formatAchievementProgress,
  type AchievementState,
} from "@/lib/achievements";

export function AchievementCabinet({
  playerName,
  state,
}: {
  playerName: string;
  state: AchievementState;
}) {
  const unlocked = new Set(state.unlocks.map(entry => entry.id));

  return (
    <section className="achievement-cabinet" aria-labelledby="achievement-title">
      <div className="achievement-heading">
        <div>
          <p className="pixel-kicker">REWARD PROTOCOL // {ACHIEVEMENTS.length} BADGES</p>
          <h2 id="achievement-title">SLOP HOG ACHIEVEMENTS</h2>
        </div>
        <strong>{String(unlocked.size).padStart(3, "0")} / {ACHIEVEMENTS.length} UNLOCKED</strong>
      </div>
      <p className="achievement-intro">
        Lifetime progress survives every redeployment. Unlocked badges are saved to your account
        and can be announced through Bluesky without granting Slop Hogs posting permission.
      </p>
      <div className="achievement-grid">
        {ACHIEVEMENTS.map(achievement => {
          const isUnlocked = unlocked.has(achievement.id);
          const progress = achievementValue(achievement, state.progress);
          return (
            <article
              className={`achievement-card tier-${achievement.tier}${isUnlocked ? " unlocked" : " locked"}`}
              key={achievement.id}
            >
              <div className="achievement-badge" aria-hidden="true">
                {isUnlocked ? "OK" : "??"}
              </div>
              <div className="achievement-copy">
                <span>{achievement.category} // {achievement.tier}</span>
                <h3>{achievement.title}</h3>
                <p>{achievement.description}</p>
                <div className="achievement-progress">
                  <i style={{ width: `${Math.min(100, progress / achievement.goal * 100)}%` }} />
                </div>
                <small>{formatAchievementProgress(progress, achievement)}</small>
              </div>
              {isUnlocked && (
                <a
                  className="achievement-share"
                  href={achievementShareUrl(achievement, playerName)}
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

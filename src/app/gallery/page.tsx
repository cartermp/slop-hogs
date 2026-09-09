import { notFound } from "next/navigation";
import { Hog } from "@/components/hog/Hog";
import { DIET_APPEARANCES } from "@/components/hog/appearance";
import { FOOD_KINDS, applyGameAction, createGameState } from "@/lib/game";

const start = Date.UTC(2026, 0, 1);

function sixMealState(food: (typeof FOOD_KINDS)[number]) {
  let state = createGameState(start, 100);
  for (let meal = 0; meal < 6; meal += 1) {
    state = applyGameAction(state, { type: "feed", food }, start).state;
  }
  return state;
}

export default function Gallery() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <p className="eyebrow">Mutation lab · art v1</p>
        <h1>Five bad ways<br />to raise a hog.</h1>
        <p>Each specimen ate six meals from one food family. This route exists for local art review.</p>
      </header>
      <section className="hog-grid" aria-label="Diet appearance gallery">
        {FOOD_KINDS.map(food => {
          const appearance = DIET_APPEARANCES[food];
          const state = sixMealState(food);
          return (
            <article className={`hog-card hog-card-${food}`} key={food}>
              <div className="hog-stage"><Hog appearance={appearance} /></div>
              <div className="hog-card-copy">
                <p className="specimen">{food.replaceAll("_", " ")}</p>
                <h2>{appearance.name}</h2>
                <p>{appearance.description}</p>
                <dl className="stat-strip">
                  <div><dt>Mass</dt><dd>{state.stats.mass} lb</dd></div>
                  <div><dt>Slop</dt><dd>{state.stats.slop}</dd></div>
                  <div><dt>Brain</dt><dd>{state.stats.brain}</dd></div>
                  <div><dt>Joy</dt><dd>{state.stats.joy}</dd></div>
                </dl>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

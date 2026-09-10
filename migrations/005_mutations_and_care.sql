UPDATE hog_lives
   SET state = state || jsonb_build_object(
     'rulesVersion', 2,
     'recentMeals', '[]'::jsonb,
     'discoveries', '[]'::jsonb,
     'equippedMutations', '[]'::jsonb,
     'lastCleanedAtMs', NULL
   )
 WHERE state->>'rulesVersion' = '1';

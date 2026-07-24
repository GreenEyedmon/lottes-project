# Rotation (Phase 2b)

Chores can rotate their assignee round-robin across household members, one turn each.

## Model

- `chore_templates.rotate` (boolean, default false). When set, generation ignores
  `default_responsible_id` and instead assigns each new occurrence to the next member.
- The rotation ring is the household's members ordered by `created_at` (stable join order).
- The anchor is **stateless**: the next assignee is the member after the assignee of the
  latest-dated existing occurrence. No cursor column to keep in sync — the occurrences
  themselves are the source of truth.
  - First occurrence of a fresh template → no prior occurrence → first member.
  - After completion (collapse) → the just-completed occurrence is the latest → next member.
  - Batch generation (keep/expire, multiple seeds) → each seed advances the ring in turn.

## Where it lives

Rotation is orchestration, not domain: the pure engine (`src/shared/chore/recurrence.ts`)
still seeds `responsibleId` from the template default. `src/worker/chores.ts#generationWrites`
is the single choke point every generation path funnels through (create, cron top-up,
post-completion, post-skip); it overrides `responsibleId` when `rotate` is on. The pure,
testable ring step is `rotatedResponsible` in `src/shared/chore/assignment.ts`.

## Deliberately deferred

- Per-member weighting / fairness by effort — round-robin is even enough at household scale.
- Skipping absent members — no presence model yet.
- Rotating an already-generated backlog when `rotate` is toggled later; only future
  occurrences rotate.

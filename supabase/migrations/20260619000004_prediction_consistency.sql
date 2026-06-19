-- Enforce that a prediction's selected result is compatible with its scoreline.
-- This replaces the narrower knockout no-draw trigger with a full consistency guard.

create or replace function cashford.enforce_prediction_consistency()
returns trigger
language plpgsql
set search_path = cashford
as $$
declare
  contest_is_knockout boolean;
begin
  select is_knockout
    into contest_is_knockout
    from cashford.contests
   where id = new.contest_id;

  if contest_is_knockout then
    if new.outcome = 'draw' then
      raise exception 'Draw is not a valid outcome for a knockout contest';
    end if;

    if new.outcome = 'home' and new.pred_home < new.pred_away then
      raise exception 'Selected knockout team cannot be losing the predicted 90-minute scoreline';
    end if;

    if new.outcome = 'away' and new.pred_away < new.pred_home then
      raise exception 'Selected knockout team cannot be losing the predicted 90-minute scoreline';
    end if;
  else
    if (new.outcome = 'home' and new.pred_home <= new.pred_away)
       or (new.outcome = 'draw' and new.pred_home <> new.pred_away)
       or (new.outcome = 'away' and new.pred_away <= new.pred_home) then
      raise exception 'Prediction outcome does not match predicted scoreline';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_no_draw_knockout on cashford.predictions;
drop trigger if exists trg_prediction_consistency on cashford.predictions;
create trigger trg_prediction_consistency
  before insert or update on cashford.predictions
  for each row execute function cashford.enforce_prediction_consistency();

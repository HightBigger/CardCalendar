alter table spend_facts add column declared_stage text not null default 'occurred'
  check (declared_stage in ('occurred','posted','settled'));

update spend_facts f set declared_stage=e.payload->>'declaredStage'
from spend_fact_events e where e.fact_id=f.id and e.event_type='created'
  and e.payload->>'declaredStage' in ('occurred','posted','settled');

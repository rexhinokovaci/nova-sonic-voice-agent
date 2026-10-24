# Runbook: Nova Sonic degraded

**Severity:** P2 · **Pages:** yes

## Is this hurting callers right now?

Yes. Slow first audio means long silences. Stream errors mean calls fall back to the IVR or an agent.

## Confirm

- `voice_agent.ttfa_ms` p95 above 1.2 s for 10 minutes, or the session `error` rate above 2%.
- Error names in logs: `ThrottlingException` (quota), `ModelTimeoutException`, `ServiceUnavailableException`, `ValidationException` (our bug: check recent deploys).

## Mitigate

| Symptom | Action |
|---|---|
| Throttling | Check Bedrock quotas for the model in the region. Shed load by routing new calls to the Lex IVR (feature flag) while a quota increase is requested. |
| Validation errors after a deploy | Roll back. Usually an event shape change. |
| Regional service issue | Route new calls to the Lex IVR. Existing sessions finish or fail to an agent. |

## Follow-up

Postmortem if more than 50 calls fell back. Add a regression test to `ScriptedModel` if the service behaved in a way the fake didn't model.

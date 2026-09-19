# Jev/TypeSafe feature engineering and structured decision prompting

Research date: 2026-09-19. Scope: public, first-party TypeSafe/Jev documentation and TypeSafe’s official SDK repositories only. No secondary articles, community SDKs, or inferred model-internals are used.

## Result

Authoritative public documentation is available. The documented contract is **state plus typed questions in, typed probabilistic answers out**. Jev is intended to supply narrow semantic judgments inside software; application code owns deterministic rules, control flow, thresholds, side effects, and escalation. [Introduction](https://docs.typesafe.ai/introduction), [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)

## 1. What Jev expects as state and features

### State

- The API request contains `state`, `model`, and a `questions` map. `state` may be a string, JSON object, or JSON array; an object is recommended when named fields, related records, or relationships matter. All questions in a request see the same state and are evaluated independently. [API reference](https://docs.typesafe.ai/api), [State](https://docs.typesafe.ai/concepts/state)
- Jev is text-only. Images, audio, and video are unsupported; the Models page says to preprocess non-text inputs into text or structured fields. The public contract describes structured JSON context, not a separate native tabular/tensor feature interface. [State](https://docs.typesafe.ai/concepts/state), [Models](https://docs.typesafe.ai/models)
- Put the content and supporting facts in `state`, including current records, policies, or retrieved knowledge needed for the judgment. Keep the questions separate; do not rely on knowledge stored in model weights when current information is available in the application’s knowledge base. [State](https://docs.typesafe.ai/concepts/state), [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- Include only context relevant to the current questions. For nested state, point an instruction at a specific field with a backticked dot/index path such as `` `support.tickets[0].message` ``. [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)

### Question outputs as engineered features

TypeSafe’s own feature-discovery cookbook treats question answers as numeric features for a downstream supervised model. It uses two feature kinds: `Noul` for presence/absence and `Score` for intensity. [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)

| Feature need | Question | Numeric signal documented by TypeSafe |
| --- | --- | --- |
| Binary fact or presence | `Noul` | One value: probability that the statement is true; range `0..1`. |
| Ordered degree or intensity | `Score` | Probability distribution over ordered levels plus a probability-weighted level position; the cookbook’s example encodes the expected level and its spread. |
| Nominal class or route | `Choice` | Selected option, full distribution over the supplied options, and confidence. |

For downstream feature engineering, the cookbook recommends features that can be judged from the source text, vary across rows, and add information not already captured by other features. In its example implementation, a `Score` distribution can become an expected level plus standard-deviation-like spread, while a `Noul` becomes its single probability. Those encodings are cookbook choices, not a claim that the API requires one feature encoding. [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)

The same cookbook evaluates proposed questions with cross-validated error, removes flat columns, tests revisions/drops by refitting, keeps a final held-out test set untouched by feature discovery, recommends deployment-matched splits, checks stability across seeds/slices, and stops on a plateau or budget. Its reported RMSE and question counts are one wine-review example using `jev-1.12`, not a general Jev benchmark. [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)

## 2. How to design Choice questions and structured prompts

### Choice semantics

- Use `Choice` when the answer is one option from a fixed, unordered set. Use `Score` for an ordered spectrum and `Noul` for a clean yes/no judgment. [Primitives](https://docs.typesafe.ai/primitives), [Choice](https://docs.typesafe.ai/primitives/choice)
- Write the complete question in `instructions`; the question ID is only a response key and is not sent to the model. Do not expect the ID to supply missing prompt meaning. [Primitives](https://docs.typesafe.ai/primitives), [API reference](https://docs.typesafe.ai/api)
- Provide the full option set. Choice accepts up to 255 options; when the taxonomy may not cover every input, add an explicit `other` or `none of the above` option. For deeper taxonomies, walk the hierarchy level by level in code rather than forcing one enormous flat label set. [Choice](https://docs.typesafe.ai/primitives/choice)
- Option names and descriptions are both sent to the model. Start with a one-line description that separates neighboring options. If confusion remains, use structured criteria with parallel fields such as what the option covers, what it is not for, and representative examples. These field names are conventions chosen by the caller, not reserved API fields. [Choice](https://docs.typesafe.ai/primitives/choice), [Advanced: structure](https://docs.typesafe.ai/primitives/advanced)

### Structured decision prompting

TypeSafe’s first-party guidance is to ask one narrow, atomic judgment per question—the kind of determination a knowledgeable person could make quickly from the supplied context. Broad prompts such as “analyze this and determine the best course of action” should be decomposed into independent questions and composed in code. [Primitives](https://docs.typesafe.ai/primitives), [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)

`instructions` and criteria entries can be strings, objects, arrays, or `null` where the primitive permits it. Use structure when the question has multiple labeled parts, needs comparison data, or benefits from examples. For a Choice, use the same field names across options so the model can compare like with like; for subtle binary boundaries, define structured `true` and `false` criteria. [Advanced: structure](https://docs.typesafe.ai/primitives/advanced)

Questions over one unchanged state are independent and can be sent together, including speculative questions whose answers matter only on some code paths. The recommended pattern is to let code ignore irrelevant answers. If a later question truly depends on an earlier answer to fetch new state, choose new options, or construct the next request, make a second request in code. [Primitives](https://docs.typesafe.ai/primitives), [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)

For a complex judgment, split dimensions into separate `Score` or `Noul` questions and combine them with explicit weights or rules in code. If Score scales have different numbers of levels, normalize each score by its top level index before weighting. [Score](https://docs.typesafe.ai/primitives/score), [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring)

## 3. Probability and confidence interpretation

| Output | What it means | Important boundary |
| --- | --- | --- |
| `Noul.noul` | Probability that the yes statement is true; `0` is no, `1` is yes. | There is no separate confidence. Near `0.5` means yes/no are similarly likely; it does not mean the midpoint of an ordered attribute. |
| `Choice.probabilities` | A distribution over exactly the supplied options; values sum to `1`. `choice` is the highest-probability option. | The distribution is not a probability of an event unless the options themselves represent the events. |
| `Choice.confidence` | A `0..1` statistic derived from the shape of the Choice distribution. Concentration on one option raises it; a flat or contested distribution lowers it. | It is not simply the winning option’s probability, and the public docs do not publish its exact formula. Keep the full distribution. |
| `Score.probabilities` | A distribution over the ordered levels; values sum to `1`. | The returned `score` is the probability-weighted level position and may be fractional; it is not the fraction of records/customers at a level. Different distributions can produce the same score. |
| `Score.confidence` | A `0..1` statistic derived from how concentrated the level distribution is. | Low confidence can indicate overlapping levels, a multi-dimensional question, or insufficient state—not necessarily only model uncertainty. |

The API bounds `Score` criteria at at least two and at most ten ordered levels. Level `0` is the first entry, and a score is bounded from `0` to the highest level index. Level descriptions should describe concrete situations, not bare numbers or vague degrees; each Score should measure one dimension. [Score](https://docs.typesafe.ai/primitives/score), [API reference](https://docs.typesafe.ai/api)

TypeSafe’s AI primer describes calibration at the population level: across many predictions, outcomes assigned `0.2` should occur about 20% of the time and outcomes assigned `0.8` about 80% of the time. This is not a guarantee for an individual answer. Higher confidence is therefore a routing signal to validate on the target workload, not proof of correctness. [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer), [Confidence](https://docs.typesafe.ai/confidence)

Thresholds are application- and risk-dependent. The official guidance is: high confidence may act automatically; medium confidence may require confirmation, review, or more evidence; low confidence should not act. Start conservatively and plot confidence against accuracy on the application’s own data. The example thresholds (`0.5` floor, `0.8`, `0.9`, or `0.6/0.85` in different examples) are illustrative policies, not universal Jev defaults. [Confidence](https://docs.typesafe.ai/confidence), [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing)

## 4. Bounds and operational limits

- `Noul`: `noul` is bounded to `0..1`. [Noul](https://docs.typesafe.ai/primitives/noul)
- `Choice`: at most 255 options. [Choice](https://docs.typesafe.ai/primitives/choice)
- `Score`: at least 2 and at most 10 levels; score range is `0..(number_of_levels - 1)`. [Score](https://docs.typesafe.ai/primitives/score)
- Jev 1.13’s Models page lists a 64k-token request context, covering state plus all questions, with a 32k-token limit for state plus the single longest question. The page also says current rate limits can change without notice. [Models](https://docs.typesafe.ai/models)
- The model alias `jev-latest` can move to a new version. If thresholds or feature behavior are tuned against a specific version, pin the versioned model ID and log the response’s actual `model`. [Models](https://docs.typesafe.ai/models)

## 5. Failure and abstention handling

### Semantic uncertainty

There is no documented model-level “abstain” answer in the public primitives or API schema. `Choice` always returns one of the supplied options, so an application that needs an explicit unknown path should include `other`/`none of the above` as an option. For a hierarchical label, the first-party confidence cookbook shows a second pattern: return a broader parent label when confidence is below a cutoff, and hand the case to a person if even that resolution is too coarse. [API reference](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence)

When confidence is low, the documented responses are to avoid guessing: ask for clarification, gather more information, fall back to another system, return a broader answer, or route to human review. A low-confidence Score is also feedback to inspect the level definitions, split multi-dimensional questions, or enrich the state. [Confidence](https://docs.typesafe.ai/confidence), [Score](https://docs.typesafe.ai/primitives/score)

### API and request failures

The HTTP API documents these error classes: `401` missing/invalid key, `422` request validation failure, `429` rate limit, and `529` temporary overload. For `429` and `529`, the documented handling is exponential backoff; the official SDKs do this by default. The public API reference does not define a semantic fallback result for a failed request, so retry, fail closed, or escalate must be owned by application code. [API reference](https://docs.typesafe.ai/api)

## Short uncertainty note

The public first-party docs are sufficient for the request/response contract and prompting patterns, but they do **not** publish the exact confidence formula, model architecture, training feature representation, or a guaranteed per-example abstention behavior. Do not invent those details. The feature-discovery cookbook is an illustrative downstream-ML recipe, not a universal feature schema or benchmark. One documentation page describes the request budget as “around 32,000 tokens,” while the current Models page specifies 64k total context and 32k for state plus the longest question; verify the live limit before production integration. [Primitives](https://docs.typesafe.ai/primitives), [Models](https://docs.typesafe.ai/models)

## First-party source inventory

- [TypeSafe documentation](https://docs.typesafe.ai/)
- [TypeSafe official Python SDK](https://github.com/typesafe-ai/typesafe-sdk-python)
- [TypeSafe official JavaScript/TypeScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)

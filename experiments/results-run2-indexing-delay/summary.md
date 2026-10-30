## Experiment results (2026-10-29)

38 test questions (30 in scope, 8 out of scope), 1 PDF(s).

| Config | Chunk | TOP_K | MIN_SCORE | Accuracy | Refused out-of-scope | Avg latency |
|---|---|---|---|---|---|---|
| baseline | 800 | 5 | 0.45 | 29% | 100% | 279 ms |
| tuned | 800 | 3 | 0.44 | 47% | 100% | 340 ms |

![Retrieval hit rate](experiments/results/retrieval_hit_rate.png)
![MIN_SCORE gate](experiments/results/min_score_gate.png)
![Baseline vs tuned](experiments/results/baseline_vs_tuned.png)
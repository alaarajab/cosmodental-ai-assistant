## Experiment results (2026-10-29)

38 test questions (30 in scope, 8 out of scope), 2 PDF(s).

| Config | Chunk | TOP_K | MIN_SCORE | Accuracy | Refused out-of-scope | Avg latency |
|---|---|---|---|---|---|---|
| baseline | 800 | 5 | 0.45 | 89% | 100% | 512 ms |
| tuned | 500 | 5 | 0.5 | 84% | 100% | 498 ms |

![Retrieval hit rate](experiments/results/retrieval_hit_rate.png)
![MIN_SCORE gate](experiments/results/min_score_gate.png)
![Baseline vs tuned](experiments/results/baseline_vs_tuned.png)
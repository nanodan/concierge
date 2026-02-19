# Future Features

Ideas and planned features for later implementation.

## Auto-tagging / Clustering

**Status:** Deferred — need to think through how clusters evolve as conversation count grows

**Concept:**
- Cluster conversations by embedding similarity
- Automatically assign tags like "bug fixes", "refactoring", "docs", "new features"
- Show tags in conversation list, allow filtering by tag

**Open Questions:**
- How do clusters change as new conversations are added?
  - Option A: Re-cluster periodically (batch job)
  - Option B: Assign new conversations to nearest existing cluster
  - Option C: Incremental clustering algorithms (e.g., DBSCAN variants)
- How many clusters? Fixed K vs dynamic?
- Should users be able to rename/merge clusters?
- Store cluster assignments on conversation or separately?

**Potential Approaches:**
1. **K-means with periodic re-clustering** — Simple, but clusters shift over time
2. **Hierarchical clustering** — Better for browsing, but expensive to recompute
3. **LLM-generated tags** — More accurate, but costs money per conversation
4. **Hybrid** — Cluster embeddings, then use LLM to name clusters once

**Dependencies:**
- Semantic search / embeddings (implement first)

---

## Conversation Quality Metrics

- Track "success rate" — did conversation end with thanks/completion vs abandonment?
- Regeneration frequency — which prompt styles need retries?
- Response time trends

## Cost Forecasting

- Predict monthly spend based on rolling usage
- Alert when on track to exceed budget
- Per-project cost breakdown

## Smart Suggestions

- "You asked something similar before" when starting new conversation
- Recommend archiving stale conversations
- Prompt templates based on what works well

## Token Budget Mode

- Set daily/weekly/monthly token limits
- Progress bar showing remaining budget
- Optional hard stop or warning when exceeded

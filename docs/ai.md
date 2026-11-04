# AI endpoint

Summaries, tags, image understanding, audio and semantic search use any OpenAI-compatible server.
With none configured those features are off and everything else works.

Settings → AI endpoint (or `AI_API_BASE_URL`, `AI_API_KEY`, `AI_TEXT_MODEL`, `AI_MULTIMODAL_MODEL`,
`EMBEDDING_MODEL`):

| Server | Address | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com` | Without `/v1`. Models as typed, e.g. `gpt-4o-mini`. |
| Ollama | `http://host.docker.internal:11434` | Models as typed. Pull them first. Needs an embedding model for search. |
| LiteLLM proxy | `https://litellm.example.com` | Set "Model names" to "Prefixed with the vendor" if your routes look like `openai/gpt-4o`. |
| vLLM, OpenRouter, others | their OpenAI-compatible root | |

**Test connection** checks the key and sends one tiny request to the text model.

Changing the embedding model: bookmarks already indexed keep the embeddings the old model made, and
those do not match queries embedded by the new one. New and re-saved bookmarks use the new model;
existing ones are not re-embedded automatically.

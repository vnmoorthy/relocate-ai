# Notice — bundled and referenced assets

The Relocate codebase is MIT-licensed (see [LICENSE](LICENSE)). This NOTICE captures licensing for assets referenced (not bundled) by this repository.

## PAVO benchmark dataset

The 50,000-turn PAVO-Bench dataset is licensed **CC-BY 4.0** and lives on HuggingFace:

- <https://huggingface.co/datasets/vnmoorthy/pavo-bench>

If you redistribute or build on the dataset, follow CC-BY 4.0 attribution requirements.

## PAVO router weights

The trained PAVO routing-layer weights (an 85,041-parameter meta-controller trained with multi-objective PPO on PAVO-Bench) are **proprietary** and not redistributed by this repository. The router's *interface* and integration patterns shown here are MIT-licensed; the underlying weights are not.

If you need access to the trained router, contact the authors via the email in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Third-party services referenced

This codebase integrates with several third-party services. Each has its own terms; the integrations themselves are MIT.

- AgentPhone (telephony)
- AgentMail (email infrastructure)
- Browser Use (browser automation API)
- Lob (certified mail API)
- Supermemory (vector memory)
- Google DeepMind (Gemini API)
- Anthropic (Claude API, optional)
- Ollama (local LLM runtime)

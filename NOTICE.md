# Notice

The source code in this repository is licensed under [MIT](LICENSE), except for
any separately identified third-party material.

## What is included

The checked-in `pavo_server/route.py` implementation is a deterministic
heuristic router written as part of this repository. It does not contain or load
learned routing weights. The MIT license applies to that checked-in code.

The repository may contain names, links, configuration examples, or adapters
for external services. An adapter's presence does not redistribute the service,
grant permission to automate a target website, or change any provider's terms.

Referenced services include AgentPhone, AgentMail, Browser Use, Lob,
Supermemory, Moss, Google Gemini, Anthropic, Stripe, Sponge, Ollama, and other
target institutions named by persona examples. Product and company names may be
trademarks of their respective owners; no endorsement is implied.

## Bundled stock footage

The ambient background videos and their poster stills in `web/public/videos/`
are derived from stock footage published by [Mixkit](https://mixkit.co) under
the [Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree),
which permits commercial use with modification and without attribution. Source
clips (re-encoded, trimmed, and color-adjusted here):

- `hero-city-dusk.*` — Mixkit clip 41374, “Aerial landscape of a huge city at dusk”
- `bg-packing.*` — Mixkit clip 31218, “Man in his living room finishes packing a box”
- `bg-routes.*` — Mixkit clip 4067, “Traffic in an underground tunnel”
- `bg-journey.*` — Mixkit clip 42038, “Driving through a night city”

The Mixkit license applies to that footage; this repository's MIT license does
not re-license it.

## What is not included

- proprietary or third-party model weights;
- learned PAVO router weights or training code;
- provider APIs, hosted services, or provider data;
- customer/provider credentials, generated webhook registries, or acceptance
  evidence;
- rights to third-party websites, forms, logos, content, or trademarks.

Older project material references a PAVO benchmark dataset hosted externally.
That dataset is not bundled here. Verify its current license and attribution
requirements at the source before downloading, redistributing, or building on
it; this repository's MIT license does not apply to external artifacts.

Operators are responsible for reviewing external model/dataset licenses,
provider terms, website automation permissions, data-processing obligations,
and regulated workflows before enabling an integration.

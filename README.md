# draftcourt

A scorecard for one pasted draft. Laya answers a fixed set of questions in one call: four scores (`clarity`, `specificity`, `audience_fit`, `tone`) and four nouls (`claim_risk`, `spam`, `missing_basis`, `pressure`). `min_confidence` is 0.6. An abstaining row is marked abstain and the card is unsure. The original draft is shown unchanged. The app does not generate replacement copy. There is no mock score path, and the client does not read `action.act_probability`. Confirm only records that a person looked.

## Setup

Python 3.10 or newer.

```bash
python -m pip install laya
```

The first decision downloads weights from https://huggingface.co/convaiinnovations/laya. Boot does not download them.

## Sidecar

```bash
python3 sidecar.py
```

Listens on `127.0.0.1:8103`. It calls `laya.Router.predict` on `POST /v1/systemone`. If Laya is not installed or a predict cannot reach a loaded model, the sidecar returns HTTP 503 `{"error":"Laya not running"}` and does not invent scores.

This sidecar is not the archived third-party `laya-serve` package. That package is a fake unless `LAYA_SERVE_BACKEND=laya`. Do not point draftcourt at a fake. If you replace this sidecar with that package anyway, set `LAYA_SERVE_BACKEND=laya` or it will return scores with no model. Official `laya[serve]` (`laya-serve` from `pip install "laya[serve]"`) is a real Router and does not use that variable.

`LAYA_SIDECAR_PORT` changes the sidecar port. `LAYA_URL` (default `http://127.0.0.1:8103`) is what the Bun app calls.

## Web app

```bash
bun install && bun run dev
```

Listens on port 3003. `bun run start` runs without the file watcher. Open http://localhost:3003. If the sidecar cannot reach a loaded model, the page shows Laya not running.

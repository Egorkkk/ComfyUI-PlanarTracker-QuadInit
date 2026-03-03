# ComfyUI-PlanarTracker-QuadInit

ComfyUI custom node that converts a quad in pixel coordinates into a SAM3 `Create Box` prompt and includes a basic interactive quad editor.

## Node

`PTQuadInitNode`

Inputs:
- `image: IMAGE` (single frame only, batch is rejected)
- `quad_json: STRING` in format `[[xTL,yTL],[xTR,yTR],[xBR,yBR],[xBL,yBL]]`
- `enforce_convex: BOOLEAN` (default `true`)
- `clamp_to_image: BOOLEAN` (default `true`)

Outputs:
- `sam3_box_prompt: STRING`
- `quad_points_px_json: STRING`
- `debug_image: IMAGE`

If `quad_json` is empty or invalid JSON, the node falls back to a centered rectangle that covers about 60% of the frame.

Example `quad_json`:

```json
[[128,72],[512,80],[500,320],[120,300]]
```

Example `sam3_box_prompt`:

```json
{"box": [0.49, 0.41, 0.61, 0.52], "label": true}
```

Example `quad_points_px_json`:

```json
[[128, 72], [512, 80], [500, 320], [120, 300]]
```

## UI Check

After restarting ComfyUI, the node loads a web extension from `web/js/quad_init.js` and adds an interactive quad editor inside the node.
The backend returns `ui.images` for `debug_image`, and the frontend extension loads that preview manually from the result descriptor.
The frontend extension draws the preview image first, then draws the quad overlay and handles on top of it.
The custom `/view?...` preview is the only surface used for quad editing and mouse interaction.
ComfyUI may also show its standard internal `IMAGE` preview for the same node; this step does not disable or reuse that built-in preview.
The preview descriptor is primarily picked up from the frontend `api` `executed` event (`ui.images`); if that path is unavailable, the extension falls back to `node.imgs[0]`.

Minimal check workflow:
- `LoadImage -> PTQuadInitNode`
- optionally connect `sam3_box_prompt` and `quad_points_px_json` into `PreviewAny`
- connect the `image` input, then click `Apply image` (or queue the workflow manually)
- after execution, the node shows the custom preview for `debug_image`, with the quad overlay drawn on top

What to verify:
- after execution, the node shows the custom preview with the quad overlay
- dragging a corner handle updates the `quad_json` text widget
- dragging the blue center handle moves the whole quad
- dragging on empty image area creates a new axis-aligned rectangle
- running the workflow updates `sam3_box_prompt` and `quad_points_px_json` from the edited `quad_json`

## Validation Rules

- point order is normalized to `TL, TR, BR, BL`
- self-intersecting quads are rejected
- concave quads are rejected when `enforce_convex=true`
- output points are rounded to integer pixels and clamped to image bounds

See [docs/quad_math.md](docs/quad_math.md) for the exact math and validation details.

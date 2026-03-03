# Quad Math

## Point Order

The node expects four 2D points that represent the same quadrilateral corners in image pixel space with origin at the top-left:

`TL -> TR -> BR -> BL`

If the input arrives in another order, the node reorders points around the centroid using angle sorting, then rotates the cycle so the first point is the top-left candidate.

## Validation

- The quad must contain exactly 4 points.
- The quad must not self-intersect.
- If `enforce_convex=true`, all consecutive cross products must have the same sign and none may be zero.
- Empty or invalid `quad_json` falls back to a default centered rectangle.

## Pixel Normalization

- Point coordinates are rounded to integer pixels.
- Output points are clamped to `[0, width - 1]` and `[0, height - 1]`.

## AABB

From the normalized quad points:

- `x1 = min(x_i)`
- `y1 = min(y_i)`
- `x2 = max(x_i) + 1`
- `y2 = max(y_i) + 1`

`x2` and `y2` are treated as the outer pixel edge (half-open box), then clamped to image size. The node enforces a minimum box extent of 2 pixels per axis when the frame size allows it.

## SAM3 Conversion

Given image width `W`, height `H`, and AABB `(x1, y1, x2, y2)`:

- `center_x = ((x1 + x2) / 2) / W`
- `center_y = ((y1 + y2) / 2) / H`
- `width = (x2 - x1) / W`
- `height = (y2 - y1) / H`

Then each value is clamped to `[0, 1]` and rounded to 2 decimal places.

The final prompt is:

```json
{"box": [center_x, center_y, width, height], "label": true}
```

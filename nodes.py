import json
import math
import os
import tempfile
import uuid
from typing import Iterable, List, Sequence, Tuple

import numpy as np
import torch
from PIL import Image, ImageDraw


Point = Tuple[float, float]
IntPoint = Tuple[int, int]


def parse_quad_json(s: str) -> List[Point]:
    raw = json.loads(s)
    if not isinstance(raw, list) or len(raw) != 4:
        raise ValueError("quad_json must be a JSON array of 4 points")

    points: List[Point] = []
    for item in raw:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise ValueError("Each quad point must be [x, y]")
        x, y = item
        points.append((float(x), float(y)))
    return points


def default_center_quad(width: int, height: int) -> List[Point]:
    x_margin = width * 0.2
    y_margin = height * 0.2
    return [
        (x_margin, y_margin),
        (width - x_margin, y_margin),
        (width - x_margin, height - y_margin),
        (x_margin, height - y_margin),
    ]


def normalize_order_tl_tr_br_bl(points: Sequence[Point]) -> List[Point]:
    if len(points) != 4:
        raise ValueError("Quad must contain exactly 4 points")

    cx = sum(p[0] for p in points) / 4.0
    cy = sum(p[1] for p in points) / 4.0
    ordered = sorted(points, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))

    start_idx = min(range(4), key=lambda i: (ordered[i][0] + ordered[i][1], ordered[i][1], ordered[i][0]))
    rotated = ordered[start_idx:] + ordered[:start_idx]

    # Ensure the cycle walks TL -> TR -> BR -> BL rather than TL -> BL -> BR -> TR.
    if rotated[1][0] < rotated[3][0]:
        rotated = [rotated[0], rotated[3], rotated[2], rotated[1]]

    return list(rotated)


def clamp_and_round_px(points: Sequence[Point], width: int, height: int) -> List[IntPoint]:
    max_x = max(width - 1, 0)
    max_y = max(height - 1, 0)
    clamped: List[IntPoint] = []
    for x, y in points:
        px = int(round(x))
        py = int(round(y))
        px = min(max(px, 0), max_x)
        py = min(max(py, 0), max_y)
        clamped.append((px, py))
    return clamped


def round_px(points: Sequence[Point]) -> List[IntPoint]:
    return [(int(round(x)), int(round(y))) for x, y in points]


def _orientation(a: IntPoint, b: IntPoint, c: IntPoint) -> int:
    value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
    if value == 0:
        return 0
    return 1 if value > 0 else -1


def _on_segment(a: IntPoint, b: IntPoint, c: IntPoint) -> bool:
    return min(a[0], c[0]) <= b[0] <= max(a[0], c[0]) and min(a[1], c[1]) <= b[1] <= max(a[1], c[1])


def _segments_intersect(p1: IntPoint, q1: IntPoint, p2: IntPoint, q2: IntPoint) -> bool:
    o1 = _orientation(p1, q1, p2)
    o2 = _orientation(p1, q1, q2)
    o3 = _orientation(p2, q2, p1)
    o4 = _orientation(p2, q2, q1)

    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and _on_segment(p1, p2, q1):
        return True
    if o2 == 0 and _on_segment(p1, q2, q1):
        return True
    if o3 == 0 and _on_segment(p2, p1, q2):
        return True
    if o4 == 0 and _on_segment(p2, q1, q2):
        return True
    return False


def is_self_intersecting(points: Sequence[IntPoint]) -> bool:
    if len(points) != 4:
        raise ValueError("Quad must contain exactly 4 points")
    return _segments_intersect(points[0], points[1], points[2], points[3]) or _segments_intersect(points[1], points[2], points[3], points[0])


def is_convex(points: Sequence[IntPoint]) -> bool:
    if len(points) != 4:
        raise ValueError("Quad must contain exactly 4 points")

    signs = []
    for i in range(4):
        p0 = points[i]
        p1 = points[(i + 1) % 4]
        p2 = points[(i + 2) % 4]
        cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
        if cross == 0:
            return False
        signs.append(cross > 0)
    return all(sign == signs[0] for sign in signs[1:])


def aabb_from_quad(points_int: Sequence[IntPoint], width: int, height: int) -> Tuple[int, int, int, int]:
    xs = [p[0] for p in points_int]
    ys = [p[1] for p in points_int]

    x1 = max(min(xs), 0)
    y1 = max(min(ys), 0)
    x2 = min(max(xs) + 1, width)
    y2 = min(max(ys) + 1, height)

    min_w = min(2, max(width, 1))
    min_h = min(2, max(height, 1))

    if x2 - x1 < min_w:
        x2 = min(width, x1 + min_w)
        x1 = max(0, x2 - min_w)
    if y2 - y1 < min_h:
        y2 = min(height, y1 + min_h)
        y1 = max(0, y2 - min_h)

    return (x1, y1, x2, y2)


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def sam3_box_from_aabb(x1: int, y1: int, x2: int, y2: int, width: int, height: int) -> dict:
    cx = _clamp_unit(((x1 + x2) / 2.0) / float(width))
    cy = _clamp_unit(((y1 + y2) / 2.0) / float(height))
    box_w = _clamp_unit((x2 - x1) / float(width))
    box_h = _clamp_unit((y2 - y1) / float(height))

    return {
        "box": [round(cx, 2), round(cy, 2), round(box_w, 2), round(box_h, 2)],
        "label": True,
    }


def draw_debug(image: torch.Tensor, quad_points_int: Sequence[IntPoint], aabb: Tuple[int, int, int, int]) -> torch.Tensor:
    array = image.detach().cpu().numpy()
    array = np.clip(array * 255.0, 0.0, 255.0).astype(np.uint8)
    pil_image = Image.fromarray(array)
    draw = ImageDraw.Draw(pil_image)

    quad_cycle = list(quad_points_int) + [quad_points_int[0]]
    draw.line(quad_cycle, fill=(255, 128, 0), width=3)
    for x, y in quad_points_int:
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 64, 64), outline=(255, 255, 255))

    x1, y1, x2, y2 = aabb
    draw.rectangle((x1, y1, max(x1, x2 - 1), max(y1, y2 - 1)), outline=(64, 255, 64), width=2)

    debug = np.asarray(pil_image).astype(np.float32) / 255.0
    return torch.from_numpy(debug).unsqueeze(0)


def _quad_json_for_output(points: Iterable[IntPoint]) -> str:
    return json.dumps([[int(x), int(y)] for x, y in points], separators=(", ", ": "))


def _save_debug_preview(debug_image: torch.Tensor) -> dict:
    array = debug_image[0].detach().cpu().numpy()
    array = np.clip(array * 255.0, 0.0, 255.0).astype(np.uint8)
    pil_image = Image.fromarray(array)

    temp_dir = None
    try:
        import folder_paths  # type: ignore

        temp_dir = folder_paths.get_temp_directory()
    except Exception:
        temp_dir = tempfile.gettempdir()

    os.makedirs(temp_dir, exist_ok=True)
    filename = f"pt_quad_init_{uuid.uuid4().hex}.png"
    file_path = os.path.join(temp_dir, filename)
    pil_image.save(file_path, compress_level=1)

    return {
        "filename": filename,
        "subfolder": "",
        "type": "temp",
    }


class PTQuadInitNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "quad_json": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                    },
                ),
                "enforce_convex": ("BOOLEAN", {"default": True}),
                "clamp_to_image": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "IMAGE")
    RETURN_NAMES = ("sam3_box_prompt", "quad_points_px_json", "debug_image")
    FUNCTION = "build_prompt"
    CATEGORY = "PlanarTracker"

    def build_prompt(self, image: torch.Tensor, quad_json: str, enforce_convex: bool = True, clamp_to_image: bool = True):
        if image.ndim != 4:
            raise ValueError(f"Expected IMAGE tensor with shape [N,H,W,C], got shape {tuple(image.shape)}")
        if image.shape[0] != 1:
            raise ValueError("PTQuadInitNode expects a single IMAGE frame; batched input (N > 1) is not supported")

        _, height, width, channels = image.shape
        if channels < 3:
            raise ValueError("PTQuadInitNode expects IMAGE tensors with at least 3 channels")

        base_frame = image[0, :, :, :3]

        try:
            raw_points = parse_quad_json(quad_json) if quad_json.strip() else default_center_quad(width, height)
        except Exception:
            raw_points = default_center_quad(width, height)

        ordered_points = normalize_order_tl_tr_br_bl(raw_points)

        validation_points = clamp_and_round_px(ordered_points, width, height) if clamp_to_image else round_px(ordered_points)
        if is_self_intersecting(validation_points) or (enforce_convex and not is_convex(validation_points)):
            raise ValueError("Invalid quad: self-intersection/concave")

        quad_points_int = clamp_and_round_px(ordered_points, width, height)
        aabb = aabb_from_quad(quad_points_int, width, height)
        sam3_box = sam3_box_from_aabb(*aabb, width=width, height=height)
        debug_image = draw_debug(base_frame, quad_points_int, aabb)

        sam3_box_prompt = json.dumps(sam3_box, separators=(", ", ": "))
        quad_points_px_json = _quad_json_for_output(quad_points_int)
        return {
            "ui": {"images": [_save_debug_preview(debug_image)]},
            "result": (sam3_box_prompt, quad_points_px_json, debug_image),
        }


NODE_CLASS_MAPPINGS = {
    "PTQuadInitNode": PTQuadInitNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PTQuadInitNode": "PT Quad Init",
}

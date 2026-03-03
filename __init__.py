from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

try:
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
except ImportError:
    module_path = Path(__file__).with_name("nodes.py")
    spec = spec_from_file_location("pt_quad_init_nodes", module_path)
    if spec is None or spec.loader is None:
        raise

    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    NODE_CLASS_MAPPINGS = module.NODE_CLASS_MAPPINGS
    NODE_DISPLAY_NAME_MAPPINGS = module.NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

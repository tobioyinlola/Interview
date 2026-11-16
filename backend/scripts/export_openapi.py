"""Write the OpenAPI schema to a file. CI fails if the committed copy drifts (frontend types
are generated from it)."""

import json
import sys
from pathlib import Path

from app.main import create_app

out = Path(sys.argv[1] if len(sys.argv) > 1 else "../frontend/openapi.json")
out.write_text(json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n")
print(f"wrote {out}")

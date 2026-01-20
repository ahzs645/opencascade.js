# Custom OpenCascade.js Build Guide

This guide documents how to create a minimal custom build of OpenCascade.js for specific use cases like Stepifi.

## Overview

The full OpenCascade.js build is ~50 MB. By selecting only the symbols needed for a specific application, we reduced this to **~10 MB** (80% smaller).

## Prerequisites

### 1. Install Depot CLI

Depot provides fast cloud-based Docker builds with better caching than GitHub Actions.

```bash
# macOS
brew install depot/tap/depot

# Linux
curl -L https://depot.dev/install-cli.sh | sh
```

### 2. Create Depot Account & Project

1. Go to https://depot.dev and create an account
2. Create a new project
3. Login via CLI:
   ```bash
   depot login
   ```

### 3. Configure Project

Create `depot.json` in the repository root:

```json
{
  "id": "YOUR_PROJECT_ID"
}
```

## Build Configuration

### Key Files

| File | Purpose |
|------|---------|
| `builds/opencascade.stepifi.yml` | Symbol list and build flags |
| `Dockerfile.stepifi` | Docker build configuration |
| `depot.json` | Depot project configuration |

### Symbol Naming Convention

**Important**: Pre-compiled bindings use base class names WITHOUT constructor suffixes.

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `TopExp_Explorer_2` | `TopExp_Explorer` |
| `BRepBuilderAPI_MakeEdge_3` | `BRepBuilderAPI_MakeEdge` |
| `gp_Pnt_3` | `gp_Pnt` |

To find available symbols, inspect the pre-built Docker image:

```bash
docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  donalffons/opencascade.js:latest -c \
  "find /opencascade.js/build/bindings/MODULE_NAME -name '*.cpp.o' | xargs -I {} basename {} .cpp.o"
```

### Build Configuration (YAML)

The `builds/opencascade.stepifi.yml` file defines:

1. **Output name**: `opencascade.stepifi.js`
2. **Symbols**: List of OpenCascade classes to include
3. **Emscripten flags**: Optimization and memory settings

Example structure:

```yaml
mainBuild:
  name: opencascade.stepifi.js
  bindings:
    # Core topology
    - symbol: TopoDS_Shape
    - symbol: TopoDS_Solid
    # ... more symbols

  emccFlags:
    - -flto
    - -fexceptions
    - -O3
    - -sEXPORT_ES6=1
    - -sUSE_ES6_IMPORT_META=0
    - -sEXPORTED_RUNTIME_METHODS=['FS']
    - -sINITIAL_MEMORY=32MB
    - -sMAXIMUM_MEMORY=4GB
    - -sALLOW_MEMORY_GROWTH=1
    - -sENVIRONMENT='web,worker'
```

### Dockerfile

The `Dockerfile.stepifi` uses a multi-stage build:

1. **Builder stage**: Uses pre-built `donalffons/opencascade.js` image with compiled bindings
2. **Output stage**: Extracts only the built WASM files

Key points:
- Must use `--platform linux/amd64` (Emscripten has issues on ARM64)
- Must set `ENV threading=single-threaded`
- Output files are created in the working directory, not `/dist/`

## Running the Build

### Quick Build Command

```bash
depot build -f Dockerfile.stepifi --platform linux/amd64 --output type=local,dest=./dist-stepifi .
```

### Extract Output Files

```bash
cp ./dist-stepifi/opencascade.stepifi.* ./dist/
```

### Full Build Script

```bash
#!/bin/bash
set -e

# Clean previous build
rm -rf ./dist-stepifi
mkdir -p ./dist-stepifi

# Build on Depot
depot build \
  -f Dockerfile.stepifi \
  --platform linux/amd64 \
  --output type=local,dest=./dist-stepifi \
  .

# Copy to dist
mkdir -p ./dist
cp ./dist-stepifi/opencascade.stepifi.* ./dist/

# Show results
echo "Build complete:"
ls -lh ./dist/opencascade.stepifi.*
```

## Troubleshooting

### Error: "Requested binding {symbol} does not exist!"

The symbol name doesn't match pre-compiled bindings. Remove `_N` suffixes:
- `TopExp_Explorer_2` → `TopExp_Explorer`

To check available symbols:
```bash
docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  donalffons/opencascade.js:latest -c \
  "ls /opencascade.js/build/bindings/TopExp/"
```

### Error: "strtoll_l follows non-static declaration"

This is a diagnostic warning from TypeScript definition generation. It doesn't cause build failure - the build continues and succeeds.

### Error: "KeyError: 'threading'"

Add to Dockerfile:
```dockerfile
ENV threading=single-threaded
```

### Build fails on ARM64

Always use `--platform linux/amd64`:
```bash
depot build --platform linux/amd64 ...
```

Or add to Dockerfile:
```dockerfile
FROM --platform=linux/amd64 donalffons/opencascade.js:latest
```

### STEP Export fails with `getWasmTableEntry` error

This is a known issue affecting STEP export. See [STEP_EXPORT_ISSUE.md](./STEP_EXPORT_ISSUE.md) for details and workarounds.

**Quick workaround**: Use BREP export instead:
```javascript
// BREP export works reliably
oc.BRepTools.Write_3(shape, '/tmp/output.brep', progressRange)
const brepContent = oc.FS.readFile('/tmp/output.brep', { encoding: 'utf8' })
```

## Symbols for Stepifi

The Stepifi application needs these OpenCascade features:

| Category | Symbols |
|----------|---------|
| **Topology** | TopoDS_Shape, TopoDS_Solid, TopoDS_Shell, TopoDS_Face, TopoDS_Edge, TopoDS_Vertex, TopoDS_Wire, TopoDS_Compound |
| **Builders** | BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeShell, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing |
| **Geometry** | gp_Pnt, gp_Vec, gp_Dir, gp_Ax1, gp_Ax2, gp_Trsf |
| **Curves** | Geom_BSplineCurve, Geom2d_BSplineCurve, Geom_Circle, Geom_Line |
| **Surfaces** | Geom_BSplineSurface, Geom_Plane, Geom_CylindricalSurface |
| **Repair** | ShapeFix_Shape, ShapeFix_Shell, ShapeUpgrade_UnifySameDomain |
| **Analysis** | BRepCheck_Analyzer, BRepGProp, GProp_GProps, Bnd_Box |
| **I/O** | STEPControl_Writer, STEPControl_Reader, StlAPI_Reader, StlAPI_Writer |

## Build Results

| Metric | Full Build | Custom Build | Improvement |
|--------|------------|--------------|-------------|
| WASM size | 50 MB | 10 MB | **80% smaller** |
| JS size | 405 KB | 207 KB | 49% smaller |
| TypeScript defs | 9.4 MB | 217 KB | 97% smaller |
| Build time (Depot) | N/A | ~5 min | Fast |

## GitHub Actions Integration

For CI/CD, create `.github/workflows/build-stepifi.yml`:

```yaml
name: Build Stepifi WASM

on:
  push:
    paths:
      - 'builds/opencascade.stepifi.yml'
      - 'Dockerfile.stepifi'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: depot/setup-action@v1

      - name: Build WASM
        uses: depot/build-push-action@v1
        with:
          project: ${{ secrets.DEPOT_PROJECT_ID }}
          token: ${{ secrets.DEPOT_TOKEN }}
          file: Dockerfile.stepifi
          platforms: linux/amd64
          outputs: type=local,dest=./dist-stepifi

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: opencascade-stepifi-wasm
          path: |
            dist-stepifi/opencascade.stepifi.js
            dist-stepifi/opencascade.stepifi.wasm
            dist-stepifi/opencascade.stepifi.d.ts
```

Add secrets to your GitHub repository:
- `DEPOT_PROJECT_ID`: Your Depot project ID
- `DEPOT_TOKEN`: API token from https://depot.dev/orgs/YOUR_ORG/tokens

## Usage in Application

```javascript
import initOpenCascade from './opencascade.stepifi.js';

async function main() {
  const oc = await initOpenCascade();

  // Create a point
  const p1 = new oc.gp_Pnt_3(0, 0, 0);
  const p2 = new oc.gp_Pnt_3(10, 0, 0);

  // Create an edge
  const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
  const shape = edge.Shape();

  // Export to STEP
  const writer = new oc.STEPControl_Writer();
  writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs);
  writer.Write('/tmp/output.step');

  // Read from virtual filesystem
  const stepData = oc.FS.readFile('/tmp/output.step');
}
```

## Adding New Symbols

1. Check if symbol exists in pre-built image:
   ```bash
   docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
     donalffons/opencascade.js:latest -c \
     "find /opencascade.js/build/bindings -name 'YourSymbol.cpp.o'"
   ```

2. Add to `builds/opencascade.stepifi.yml`:
   ```yaml
   - symbol: YourSymbol
   - symbol: Handle_YourSymbol  # If it's a Handle type
   ```

3. Rebuild:
   ```bash
   depot build -f Dockerfile.stepifi --platform linux/amd64 --output type=local,dest=./dist-stepifi .
   ```

## References

- [OpenCascade.js Documentation](https://ocjs.org/)
- [OpenCascade.js GitHub](https://github.com/donalffons/opencascade.js)
- [Depot Documentation](https://depot.dev/docs)
- [Emscripten Documentation](https://emscripten.org/docs/)
- [STEP Export Issue](./STEP_EXPORT_ISSUE.md) - Known issue with STEP export and workarounds

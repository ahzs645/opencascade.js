#!/bin/bash
# Build Stepifi WASM using Depot
#
# Prerequisites:
#   1. Install Depot CLI: brew install depot/tap/depot
#   2. Login to Depot: depot login
#
# Usage:
#   ./scripts/build-stepifi.sh
#
# Options:
#   --large    Use larger 32-CPU machine (faster, uses more build minutes)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Parse arguments
DEPOT_ARGS=""
if [[ "$1" == "--large" ]]; then
    echo "=== Using large machine (32 CPU) ==="
    DEPOT_ARGS="--build-arg DEPOT_CPUS=32"
fi

echo "=== Step 1: Building Docker image with Depot ==="
echo "This builds ONLY the base image (no pre-compilation)"
depot build \
    -f Dockerfile.stepifi \
    --tag opencascade-stepifi:latest \
    --load \
    --platform linux/amd64 \
    $DEPOT_ARGS \
    .

echo ""
echo "=== Step 2: Building Stepifi WASM ==="
echo "This compiles only the symbols needed for Stepifi"
mkdir -p dist

docker run --rm \
    -v "$(pwd)/builds:/src/builds:ro" \
    -v "$(pwd)/src:/opencascade.js/src:ro" \
    -v "$(pwd)/dist:/opencascade.js/dist" \
    opencascade-stepifi:latest \
    /src/builds/opencascade.stepifi.yml

echo ""
echo "=== Build complete ==="
echo "Output files:"
ls -lh dist/opencascade.stepifi.* 2>/dev/null || echo "No output files found"

#!/bin/bash
# Build Stepifi custom OpenCascade.js WASM using Depot
#
# Prerequisites:
#   1. Install Depot CLI: brew install depot/tap/depot
#   2. Login to Depot: depot login
#   3. Update depot.json with your project ID
#
# Usage:
#   ./scripts/build-stepifi.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== Building Stepifi WASM on Depot ==="
echo "This will take ~5 minutes..."
echo ""

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

echo ""
echo "=== Build Complete ==="
echo ""
echo "Output files:"
ls -lh ./dist/opencascade.stepifi.*
echo ""
echo "Files are in ./dist/"

#!/usr/bin/python3

import os
import subprocess
import json
import hashlib
from itertools import chain
import yaml
from generateBindings import generateCustomCodeBindings
from compileBindings import compileCustomCodeBindings
import shutil
from cerberus import Validator
from argparse import ArgumentParser
from Common import ocIncludePaths, additionalIncludePaths

parser = ArgumentParser()
parser.add_argument(dest="filename", help="Custom build input file (.yml)", metavar="FILE.yml")
parser.add_argument("--add", dest="add_symbols", nargs="+", metavar="SYMBOL",
                    help="Add one or more symbols to the build config (e.g., --add BRepPrimAPI_MakeBox gp_Pnt)")
parser.add_argument("--force", action="store_true",
                    help="Force rebuild even if config hasn't changed")
args = parser.parse_args()

libraryBasePath = "/opencascade.js/build"
versionFilePath = os.path.join(os.path.dirname(args.filename), ".build_hash")

def computeConfigHash(filename):
  """Compute SHA-256 hash of the build configuration file."""
  with open(filename, "rb") as f:
    return hashlib.sha256(f.read()).hexdigest()

def checkNeedsRebuild(filename):
  """Check if rebuild is needed by comparing config hash."""
  currentHash = computeConfigHash(filename)
  if os.path.exists(versionFilePath):
    with open(versionFilePath, "r") as f:
      savedHash = f.read().strip()
    if savedHash == currentHash:
      return False
  return True

def saveConfigHash(filename):
  """Save the current config hash after successful build."""
  currentHash = computeConfigHash(filename)
  with open(versionFilePath, "w") as f:
    f.write(currentHash)

def addSymbolsToConfig(filename, symbols):
  """Add new symbols to the build config, filter duplicates, and sort."""
  with open(filename, "r") as f:
    config = yaml.safe_load(f)

  # Get existing symbols
  existingSymbols = {b["symbol"] for b in config["mainBuild"]["bindings"]}

  # Add new symbols (avoiding duplicates)
  newSymbols = [s for s in symbols if s not in existingSymbols]
  if newSymbols:
    for symbol in newSymbols:
      config["mainBuild"]["bindings"].append({"symbol": symbol})

    # Sort bindings by symbol name
    config["mainBuild"]["bindings"].sort(key=lambda x: x["symbol"])

    # Write back
    with open(filename, "w") as f:
      yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    print(f"Added {len(newSymbols)} new symbol(s): {', '.join(newSymbols)}")
  else:
    print("All specified symbols already exist in config")

  return len(newSymbols) > 0

# Handle --add flag: add symbols to config
symbolsAdded = False
if args.add_symbols:
  symbolsAdded = addSymbolsToConfig(args.filename, args.add_symbols)

# Check if rebuild is needed
needsRebuild = args.force or symbolsAdded or checkNeedsRebuild(args.filename)
if not needsRebuild:
  print("Build config unchanged, skipping rebuild. Use --force to rebuild anyway.")
  exit(0)

buildConfig = yaml.safe_load(open(args.filename, "r"))
schema = eval(open("/opencascade.js/src/customBuildSchema.py", "r").read())
v = Validator(schema)
if not v.validate(buildConfig, schema):
  raise Exception(v.errors)
buildConfig = v.normalized(buildConfig)

try:
  shutil.rmtree(libraryBasePath + "/bindings/myMain.h")
except Exception:
  pass

# Combine additionalCppCode from inline and files
def loadAdditionalCppCode(buildConfig, configFilePath):
  """Load and combine additionalCppCode from inline content and files."""
  cppCode = buildConfig.get("additionalCppCode", "")

  # Load from files if specified
  cppCodeFiles = buildConfig.get("additionalCppCodeFiles", [])
  if cppCodeFiles:
    configDir = os.path.dirname(configFilePath)
    for filePath in cppCodeFiles:
      # Resolve path relative to the config file directory
      if not os.path.isabs(filePath):
        fullPath = os.path.join(configDir, filePath)
      else:
        fullPath = filePath

      if os.path.exists(fullPath):
        with open(fullPath, "r") as f:
          fileContent = f.read()
          cppCode += "\n" + fileContent
          print(f"Loaded additionalCppCode from: {filePath}")
      else:
        raise Exception(f"additionalCppCodeFile not found: {fullPath}")

  return cppCode

additionalCppCode = loadAdditionalCppCode(buildConfig, args.filename)
generateCustomCodeBindings(additionalCppCode)
compileCustomCodeBindings({
  "threading": os.environ['threading'],
})

def verifyBinding(binding) -> bool:
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
    for item in filenames:
      if item.endswith(".cpp.o") and binding["symbol"] == item[:-6]:
        return True
  return False

def verifyBindings(bindings) -> bool:
  for binding in bindings:
    if not verifyBinding(binding):
      raise Exception("Requested binding " + json.dumps(binding) + " does not exist!")

verifyBindings(buildConfig["mainBuild"]["bindings"])
for extraBuild in buildConfig["extraBuilds"]:
  verifyBindings(extraBuild)

# def shouldProcessSymbol(symbol: str, bindings) -> bool:
#     if len(bindings) == 0:
#         return True
#     entry = next((b for b in bindings if b["symbol"] == symbol), None)
#     if not entry is None:
#         return True
#     return False


def shouldProcessSymbol(symbol: str, bindings) -> bool:
    if not bindings:
        return True

    # Split into include and exclude sets
    include_set = {b["symbol"] for b in bindings if not b["symbol"].startswith("--")}
    exclude_set = {b["symbol"][2:] for b in bindings if b["symbol"].startswith("--")}

    if include_set:
        # Only include symbols explicitly listed
        return symbol in include_set
    else:
        # Include everything except symbols exactly in exclude_set
        return symbol not in exclude_set

typescriptDefinitions = []
for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
  for item in filenames:
    if item.endswith(".d.ts.json") and shouldProcessSymbol(item[:-10], list(chain(buildConfig["mainBuild"]["bindings"], *list(map(lambda x: x["bindings"], buildConfig["extraBuilds"]))))):
      f = open(dirpath + "/" + item, "r")
      typescriptDefinitions.append(json.loads(f.read()))

def runBuild(build):
  def getAdditionalBindCodeO():
    if "additionalBindCode" in build:
      try:
        os.mkdir(libraryBasePath + "/additionalBindCode")
      except Exception:
        pass
      additionalBindCodeFileName = libraryBasePath + "/additionalBindCode/" + build["name"] + ".cpp"
      f = open(additionalBindCodeFileName, "w")
      f.write(build["additionalBindCode"])
      f.close()
      print("building " + additionalBindCodeFileName)
      command = [
        "emcc",
        "-flto",
        "-fexceptions",
        "-sDISABLE_EXCEPTION_CATCHING=0",
        "-DIGNORE_NO_ATOMICS=1",
        "-DOCCT_NO_PLUGINS",
        "-frtti",
        "-DHAVE_RAPIDJSON",
        "-Os",
        "-pthread" if os.environ["threading"] == "multi-threaded" else "",
        *list(map(lambda x: "-I" + x, ocIncludePaths + additionalIncludePaths)),
        "-c", additionalBindCodeFileName,
      ]
      subprocess.check_call([
        *command,
        "-o", additionalBindCodeFileName + ".o",
      ])
      return additionalBindCodeFileName + ".o"
    else:
      return None
  additionalBindCodeO = getAdditionalBindCodeO()
  print("Running build: " + build["name"])
  bindingsO = []
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
    for item in filenames:
      if item.endswith(".cpp.o") and shouldProcessSymbol(item[:-6], build["bindings"]):
        bindingsO.append(dirpath + "/" + item)
  sourcesO = []
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/sources"):
    for item in filenames:
      if item in [
        "XBRepMesh.o",
      ]:
        continue
      if item.endswith(".o"):
        sourcesO.append(dirpath + "/" + item)
  subprocess.check_call([
    "emcc", "-lembind", ("" if additionalBindCodeO is None else additionalBindCodeO),
    *bindingsO, *sourcesO,
    "-o", os.getcwd() + "/" + build["name"],
    "-pthread" if os.environ["threading"] == "multi-threaded" else "",
    *build["emccFlags"],
  ])
  print("Build finished")

runBuild(buildConfig["mainBuild"])
for extraBuild in buildConfig["extraBuilds"]:
  runBuild(extraBuild)

if buildConfig["generateTypescriptDefinitions"]:
  typescriptDefinitionOutput = ""
  typescriptExports = []
  for dts in typescriptDefinitions:
    typescriptDefinitionOutput += dts[".d.ts"]
    for export in dts["exports"]:
      typescriptExports.append({
        "export": export,
        "kind": dts["kind"],
      })

  typescriptDefinitionOutput += \
    "\nexport type OpenCascadeInstance = {FS: typeof FS} & {\n  " + ";\n  ".join(map(lambda x: x["export"] + ((": typeof " + x["export"]) if x["kind"] == "class" else (": " + x["export"] + "_Vals")), typescriptExports)) + ";\n" + \
    "};\n\n"

  # Read TypeScript extras from separate file
  with open("/opencascade.js/src/tsExtras.d.ts", "r") as tsExtrasFile:
    typescriptDefinitionOutput += tsExtrasFile.read()

  with open(os.getcwd() + "/" + os.path.splitext(buildConfig["mainBuild"]["name"])[0] + ".d.ts", "w") as typescriptDefinitionsFile:
    typescriptDefinitionsFile.write(typescriptDefinitionOutput)

# Save config hash after successful build
saveConfigHash(args.filename)
print("Build completed successfully. Config hash saved.")

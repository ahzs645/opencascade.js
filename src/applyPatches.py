#!/usr/bin/python3

import os
import subprocess

os.chdir("/")

for dirpath, dirnames, filenames in os.walk("/opencascade.js/src/patches"):
  for filename in filenames:
    print("applying patch " + dirpath + "/" + filename)
    patchFile = open(dirpath + "/" + filename, 'r')
    p = patchFile.read()
    patchFile.close()
    try:
      subprocess.check_call(["patch -p0 < '"+ dirpath + "/" + filename + "'"], stdout=subprocess.PIPE, shell=True)
      print("...done applying patch")
    except:
      raise Exception("Could not apply patch!")

# Ensure OCCT macros do not leak into embind headers.
intcurve_path = "/occt/src/IntCurve/IntCurve_IntConicConic.lxx"
if os.path.exists(intcurve_path):
  with open(intcurve_path, "r", encoding="utf-8") as f:
    content = f.read()
  if "#undef CONSTRUCTOR" not in content:
    with open(intcurve_path, "a", encoding="utf-8") as f:
      f.write("\n#undef CONSTRUCTOR\n#undef PERFORM\n")
    print("appended #undef CONSTRUCTOR/PERFORM to " + intcurve_path)

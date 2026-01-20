import os

def filterIncludeFile(filename):
  # Support .h and .hxx extensions only
  # Note: .gxx files are template implementation files that require specific
  # template parameters to be defined before inclusion. They should NOT be
  # included as regular headers - they cause compilation errors like:
  # "use of undeclared identifier 'AppBlend_AppSurf'" when included without
  # the required template parameter macros defined.
  if os.path.splitext(filename)[1] not in [".h", ".hxx"]:
    return False

  # OpenGL is not available in WebAssembly/Emscripten
  if filename.startswith("OpenGl_"):
    return False

  # fatal error: 'AIS_LocalStatus.hxx' file not found
  if (
    filename == "AIS_DataMapOfSelStat.hxx" or
    filename == "AIS_DataMapIteratorOfDataMapOfSelStat.hxx"
  ):
    return False

  # fatal error: 'X11/Xlib.h' file not found
  if (
    filename == "InterfaceGraphic.hxx"
  ):
    return False

  # fatal error: 'X11/XWDFile.h' file not found
  if filename == "Aspect_XWD.hxx":
    return False

  # fatal error: 'X11/Shell.h' file not found
  if filename == "IVtkDraw_Interactor.hxx":
    return False

  # error: use of undeclared identifier 'myBoxes' / error: use of undeclared identifier 'myElements'
  if filename == "BVH_IndexedBoxSet.hxx":
    return False

  # error: "Atomic operation isn't implemented for current platform!"
  if (
    filename == "BOPDS_Iterator.hxx" or
    filename == "BOPDS_IteratorSI.hxx" or
    filename == "BOPTools_BoxTree" or
    filename == "BOPTools_BoxTree.hxx" or
    filename == "BVH_LinearBuilder.hxx" or
    filename == "BVH_RadixSorter.hxx" or
    filename == "OSD_Parallel.hxx" or
    filename == "OSD_ThreadPool.hxx" or
    filename == "Standard_Atomic.hxx" or
    filename == "BOPTools_Parallel.hxx" or
    filename == "BVH_DistanceField.hxx"
  ):
    return False

  # fatal error: 'vtkType.h' file not found
  if (
    filename == "IVtk_Types.hxx" or
    filename == "IVtk_IShape.hxx" or
    filename == "IVtk_IShapeData.hxx" or
    filename == "IVtk_IShapeMesher.hxx" or
    filename == "IVtk_IShapePickerAlgo.hxx" or
    filename == "IVtkOCC_SelectableObject.hxx" or
    filename == "IVtkOCC_Shape.hxx" or
    filename == "IVtkOCC_ShapeMesher.hxx" or
    filename == "IVtkOCC_ShapePickerAlgo.hxx" or
    filename == "IVtk_IShapePickerAlgo.hxx" or
    filename == "IVtkTools.hxx" or
    filename == "IVtkTools_DisplayModeFilter.hxx" or
    filename == "IVtkTools_ShapeDataSource.hxx" or
    filename == "IVtkTools_ShapeObject.hxx" or
    filename == "IVtkTools_ShapePicker.hxx" or
    filename == "IVtkTools_SubPolyDataFilter.hxx" or
    filename == "IVtkVTK_ShapeData.hxx"
  ):
    return False

  # fatal error: 'vtkSmartPointer.h' file not found 
  if (
    filename == "IVtkVTK_View.hxx"
  ):
    return False

  # fatal error: 'windows.h' file not found 
  if (
    filename == "OSD_WNT.hxx" or
    filename == "WNT_Dword.hxx"
  ):
    return False

  # fatal error: 'vtkActor.h' file not found
  if filename == "IVtkDraw_HighlightAndSelectionPipeline.hxx":
    return False

  # error: expected member name or ';' after declaration specifiers
  if filename == "math_Householder.hxx":
    return False

  # error: ViewerTest_CmdParser.hxx has ArgInt method which conflicts with
  # igesread.h macro: #define ArgInt 3
  # This causes "expected member name or ';' after declaration specifiers" errors
  if filename == "ViewerTest_CmdParser.hxx":
    return False

  # error: declaration of 'ExprIntrpparse' has a different language linkage
  # This file has extern "C" declarations that conflict with C++ bindings
  if filename == "ExprIntrp_yaccintrf.hxx":
    return False

  # error: This file is usable only in C++/CLI (.NET) programs
  # NCollection_Haft.h is for .NET interop only
  if filename == "NCollection_Haft.h":
    return False

  return True

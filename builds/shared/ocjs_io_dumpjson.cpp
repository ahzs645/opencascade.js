// OCJS_IO: DumpJson to string
// Requires: ocjs_io_common.cpp

  // TopoDS_Shape::DumpJson -> std::string
  static std::string Shape_DumpJsonToString(const TopoDS_Shape& shape, Standard_Integer depth = -1) {
    std::ostringstream ss;
    shape.DumpJson(ss, depth);
    return ss.str();
  }

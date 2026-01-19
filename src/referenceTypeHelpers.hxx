#include <functional>

template<typename T>
T getReferenceValue(const emscripten::val& v) {
  if(!(v.typeOf().as<std::string>() == "object")) {
    return v.as<T>(allow_raw_pointers());
  } else if(v.typeOf().as<std::string>() == "object" && v.hasOwnProperty("current")) {
    return v["current"].as<T>(allow_raw_pointers());
  }
  throw("unsupported type");
}

template<typename T>
void updateReferenceValue(emscripten::val& v, T& val) {
  if(v.typeOf().as<std::string>() == "object" && v.hasOwnProperty("current")) {
    v.set("current", val);
  }
}

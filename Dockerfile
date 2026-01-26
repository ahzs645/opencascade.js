FROM emscripten/emsdk:3.1.51 AS base-image

RUN \
  apt update -y && \
  apt install -y \
  bash \
  build-essential \
  cmake \
  curl \
  git \
  libffi-dev \
  libgdbm-dev \
  libncurses5-dev \
  libnss3-dev \
  libreadline-dev \
  libsqlite3-dev \
  libssl-dev \
  libbz2-dev \
  npm \
  python3 \
  python3-pip \
  python3-setuptools \
  zlib1g-dev

RUN \
  pip install \
  libclang==16.0.6 \
  pyyaml==6.0.1 \
  cerberus==1.3.5 \
  argparse==1.4.0

WORKDIR /rapidjson/
RUN \
  git clone -b v1.1.0 https://github.com/Tencent/rapidjson.git . 

WORKDIR /freetype/
RUN \
  git clone -b VER-2-13-0 https://github.com/freetype/freetype.git .

WORKDIR /occt/
RUN \
  curl -L "https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_7_0.tar.gz" -o occt.tar.gz && \
  tar -xvf occt.tar.gz --strip-components=1

WORKDIR /opencascade.js/
COPY src ./src
WORKDIR /src/

ARG threading=single-threaded
ENV threading=$threading

FROM base-image AS test-image

RUN \
  mkdir /opencascade.js/build/ && \
  mkdir /opencascade.js/dist/ && \
  /opencascade.js/src/applyPatches.py

ENTRYPOINT ["/opencascade.js/src/buildFromYaml.py"]

FROM test-image AS custom-build-image

RUN /opencascade.js/src/generateBindings.py
RUN /opencascade.js/src/compileBindings.py ${threading}
RUN /opencascade.js/src/compileSources.py ${threading}
RUN \
  chmod -R 777 /opencascade.js/ && \
  chmod -R 777 /occt

ENTRYPOINT ["/opencascade.js/src/buildFromYaml.py"]

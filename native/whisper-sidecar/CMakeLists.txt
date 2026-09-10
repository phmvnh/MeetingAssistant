cmake_minimum_required(VERSION 3.14)
project(whisper_sidecar CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Tùy chọn cho whisper.cpp
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "Build tests" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "Build examples" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libs" FORCE)

# Kiểm tra nếu có submodule hoặc thư mục whisper.cpp
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/whisper.cpp/CMakeLists.txt")
    add_subdirectory(whisper.cpp)
else()
    message(STATUS "whisper.cpp source not bundled in native/whisper-sidecar/whisper.cpp")
endif()

add_executable(whisper-sidecar
    src/main.cpp
)

if(TARGET whisper)
    target_link_libraries(whisper-sidecar PRIVATE whisper)
    target_include_directories(whisper-sidecar PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/whisper.cpp/include"
    )
else()
    message(FATAL_ERROR "whisper.cpp target was not created")
endif()

# Windows runtime configuration
if(WIN32)
    target_compile_definitions(whisper-sidecar PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()

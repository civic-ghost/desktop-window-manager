cmake_minimum_required(VERSION 3.15)
project(desktop_window_manager)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
set(SOURCE_FILES
    src/window_manager_win.cpp
)

# Create the addon library
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})

# External libs and includes
set(LIBS "")
set(INCLUDES "")

# Platform-specific settings
if(WIN32)
    message(STATUS "Windows build")
    
    # MSVC-specific compiler flags
    if("${CMAKE_CXX_COMPILER_ID}" STREQUAL "MSVC")
        message(STATUS "MSVC compiler in use")
        set(CMAKE_CXX_FLAGS "/W4 /EHsc")
    endif()
    
elseif(UNIX AND NOT APPLE)
    message(STATUS "Linux build")
    list(APPEND LIBS "-lX11" "-lXtst")
    
    if(NOT "${CMAKE_CXX_COMPILER_ID}" STREQUAL "MSVC")
        set(CMAKE_CXX_FLAGS "-Wall -Wparentheses -Winline -Wextra")
    endif()
endif()

# N-API definitions
add_compile_definitions(NAPI_DISABLE_CPP_EXCEPTIONS)
add_compile_definitions(NAPI_VERSION=8)

# cmake-js provides these paths automatically
list(APPEND INCLUDES ${CMAKE_JS_INC})
message(STATUS "Node.js includes from cmake-js: ${CMAKE_JS_INC}")

list(APPEND LIBS ${CMAKE_JS_LIB})
message(STATUS "Node.js libs from cmake-js: ${CMAKE_JS_LIB}")

# N-API headers
target_include_directories(${PROJECT_NAME} PRIVATE 
    "${CMAKE_SOURCE_DIR}/node_modules/node-addon-api"
)

# Change suffix to .node
set_target_properties(${PROJECT_NAME} PROPERTIES 
    PREFIX "" 
    SUFFIX ".node"
    OUTPUT_NAME "desktop_window_manager"
)

# Build
target_include_directories(${PROJECT_NAME} PRIVATE ${INCLUDES})
target_link_libraries(${PROJECT_NAME} ${LIBS})

# Copy the built .node file to prebuilds directory
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory
        ${CMAKE_SOURCE_DIR}/prebuilds/win32-x64
    COMMAND ${CMAKE_COMMAND} -E copy
        $<TARGET_FILE:${PROJECT_NAME}>
        ${CMAKE_SOURCE_DIR}/prebuilds/win32-x64/desktop_window_manager.node
    COMMENT "Copying .node file to prebuilds directory"
)

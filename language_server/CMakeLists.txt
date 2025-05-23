# Copyright (c) 2019 Broadcom.
# The term "Broadcom" refers to Broadcom Inc. and/or its subsidiaries.
#
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Broadcom, Inc. - initial API and implementation

PROJECT(hlasm_language_server)

include(GoogleTest)

# compile sources to the executable
add_library(hlasm_language_server_base OBJECT)

target_compile_features(hlasm_language_server_base PUBLIC cxx_std_20)
target_compile_options(hlasm_language_server_base PRIVATE ${HLASM_EXTRA_FLAGS})
set_target_properties(hlasm_language_server_base PROPERTIES CXX_EXTENSIONS OFF)

target_include_directories(hlasm_language_server_base PRIVATE src)

add_executable(hlasm_language_server)

target_compile_features(hlasm_language_server PRIVATE cxx_std_20)
target_compile_options(hlasm_language_server PRIVATE ${HLASM_EXTRA_FLAGS})
set_target_properties(hlasm_language_server PROPERTIES CXX_EXTENSIONS OFF)

add_subdirectory(src)

# link executable with libraries
target_link_libraries(hlasm_language_server_base PRIVATE nlohmann_json::nlohmann_json)
target_link_libraries(hlasm_language_server_base PRIVATE boost-asio)
target_link_libraries(hlasm_language_server_base PUBLIC parser_library)

target_link_libraries(hlasm_language_server PRIVATE hlasm_language_server_base)
target_link_libraries(hlasm_language_server PRIVATE nlohmann_json::nlohmann_json)
target_link_libraries(hlasm_language_server PRIVATE boost-asio)
target_link_libraries(hlasm_language_server PRIVATE Threads::Threads)
target_link_libraries(hlasm_language_server PRIVATE hlasm_utils)

target_link_options(hlasm_language_server PRIVATE ${HLASM_EXTRA_LINKER_FLAGS})

if(BUILD_TESTING)
    add_subdirectory(test)
endif()

# Copyright (c) 2021 Broadcom.
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

target_sources(parser_library PRIVATE
    assembler_options.cpp
    assembler_options.h
    b4g_config.cpp
    b4g_config.h
    pgm_conf.cpp
    pgm_conf.h
    proc_grps.cpp
    proc_grps.h
)

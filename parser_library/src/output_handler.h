/*
 * Copyright (c) 2024 Broadcom.
 * The term "Broadcom" refers to Broadcom Inc. and/or its subsidiaries.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Broadcom, Inc. - initial API and implementation
 */

#ifndef HLASMPARSER_PARSERLIBRARY_OUTPUT_HANDLER_H
#define HLASMPARSER_PARSERLIBRARY_OUTPUT_HANDLER_H

#include <string_view>

namespace hlasm_plugin::parser_library {
class output_handler
{
protected:
    ~output_handler() = default;

public:
    virtual void mnote(unsigned char level, std::string_view text) = 0;
    virtual void punch(std::string_view text) = 0;
};
} // namespace hlasm_plugin::parser_library

#endif

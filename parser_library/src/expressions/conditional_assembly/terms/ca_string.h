/*
 * Copyright (c) 2019 Broadcom.
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

#ifndef HLASMPLUGIN_PARSERLIBRARY_CA_STRING_H
#define HLASMPLUGIN_PARSERLIBRARY_CA_STRING_H

#include "../ca_expression.h"
#include "semantics/concatenation.h"

namespace hlasm_plugin::parser_library::expressions {

// represents CA expression string
class ca_string final : public ca_expression
{
public:
    struct substring_t
    {
        ca_expr_ptr start;
        ca_expr_ptr count;
        range substring_range;
    };

    const semantics::concat_chain value;
    ca_expr_ptr duplication_factor;
    substring_t substring;
    static constexpr size_t MAX_STR_SIZE = 4064;

    ca_string(semantics::concat_chain value, ca_expr_ptr duplication_factor, substring_t substring, range expr_range);

    bool get_undefined_attributed_symbols(
        std::vector<context::id_index>& symbols, const evaluation_context& eval_ctx) const override;

    void resolve_expression_tree(ca_expression_ctx expr_ctx, diagnostic_op_consumer& diags) override;

    bool is_character_expression(character_expression_purpose purpose) const override;

    void apply(ca_expr_visitor& visitor) const override;

    context::SET_t evaluate(const evaluation_context& eval_ctx) const override;

    static std::string duplicate(
        const ca_expr_ptr& dupl_factor, std::string value, range expr_range, const evaluation_context& eval_ctx);
};

} // namespace hlasm_plugin::parser_library::expressions


#endif

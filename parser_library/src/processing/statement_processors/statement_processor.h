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

#ifndef PROCESSING_STATEMENT_PROCESSOR_H
#define PROCESSING_STATEMENT_PROCESSOR_H

#include <optional>

#include "analyzing_context.h"
#include "diagnosable_ctx.h"
#include "processing/op_code.h"
#include "processing/statement.h"
#include "processing/statement_providers/statement_provider_kind.h"

namespace hlasm_plugin::parser_library::processing {

class statement_processor;

using processor_ptr = std::unique_ptr<statement_processor>;

// interface for statement processors
// they are provided statements which they process in different fashion
// their processing can be interrupted by changing the provider (with 'terminal_condition') and they can end their
// processing when their need for statements is satisfied
class statement_processor
{
public:
    statement_processor(const processing_kind kind, const analyzing_context& ctx, diagnosable_ctx& diag_ctx)
        : kind(kind)
        , ctx(ctx)
        , hlasm_ctx(*ctx.hlasm_ctx)
        , diag_ctx(diag_ctx)
    {}

    // infers processing status of rest of the statement from instruction field
    // used for statement providers to correctly provide statement
    virtual std::optional<processing_status> get_processing_status(
        const std::optional<context::id_index>& instruction, const range& r) const = 0;
    virtual void process_statement(context::shared_stmt_ptr statement) = 0;
    virtual void end_processing() = 0;
    virtual bool terminal_condition(const statement_provider_kind kind) const = 0;
    virtual bool finished() = 0;

    std::optional<context::id_index> resolve_instruction(const semantics::instruction_si& instruction) const;

    const processing_kind kind;

    virtual ~statement_processor() = default;

protected:
    analyzing_context ctx;
    context::hlasm_context& hlasm_ctx;
    diagnosable_ctx& diag_ctx;

    void add_diagnostic(diagnostic_op d) const { diag_ctx.add_diagnostic(std::move(d)); }

private:
    virtual std::optional<context::id_index> resolve_concatenation(
        const semantics::concat_chain& concat, const range& r) const = 0;
};

} // namespace hlasm_plugin::parser_library::processing

#endif

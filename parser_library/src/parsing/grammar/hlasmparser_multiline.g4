/*
 * Copyright (c) 2022 Broadcom.
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

 //starting statement rules
 //rules for identifier, number, remark
parser grammar hlasmparser_multiline;

import
label_field_rules,
operand_field_rules,
instruction_field_rules,
lookahead_rules,
machine_operand_rules,
assembler_operand_rules,
ca_operand_rules,
macro_operand_rules,
model_operand_rules,
machine_expr_rules,
data_def_rules,
ca_expr_rules,
deferred_operand_rules;

@header
{
    #include "lexing/token.h"
    #include "lexing/token_stream.h"
    #include "parsing/parser_impl.h"
    #include "expressions/conditional_assembly/ca_operator_unary.h"
    #include "expressions/conditional_assembly/ca_operator_binary.h"
    #include "expressions/conditional_assembly/terms/ca_constant.h"
    #include "expressions/conditional_assembly/terms/ca_expr_list.h"
    #include "expressions/conditional_assembly/terms/ca_function.h"
    #include "expressions/conditional_assembly/terms/ca_string.h"
    #include "expressions/conditional_assembly/terms/ca_symbol.h"
    #include "expressions/conditional_assembly/terms/ca_symbol_attribute.h"
    #include "expressions/conditional_assembly/terms/ca_var_sym.h"
    #include "expressions/mach_expr_term.h"
    #include "expressions/mach_operator.h"
    #include "expressions/data_definition.h"
    #include "semantics/operand_impls.h"
    #include "utils/string_operations.h"
    #include "utils/truth_table.h"

    namespace hlasm_plugin::parser_library::parsing
    {
        using namespace hlasm_plugin::parser_library;
        using namespace hlasm_plugin::parser_library::semantics;
        using namespace hlasm_plugin::parser_library::context;
        using namespace hlasm_plugin::parser_library::checking;
        using namespace hlasm_plugin::parser_library::expressions;
        using namespace hlasm_plugin::parser_library::processing;
    }

    /* disables unreferenced parameter (_localctx) warning */
    #ifdef _MSC_VER
        #pragma warning(push)
        #pragma warning(disable: 4100)
    #endif
}

@members {
    using parser_impl::initialize;
}

@footer
{
    #ifdef _MSC_VER
        #pragma warning(pop)
    #endif
}

options {
    tokenVocab = lex;
    superClass = parser_impl;
}

program : EOF;

lab_instr returns [std::optional<lexing::u8string_with_newlines> op_text, range op_range, size_t op_logical_column = 0]
    : PROCESS (SPACE (~EOF)*)? EOF
    {
        collector.set_label_field(provider.get_range($PROCESS));
        collector.set_instruction_field(
            parse_identifier($PROCESS->getText(),provider.get_range($PROCESS)),
            provider.get_range( $PROCESS));
        collector.add_hl_symbol(token_info(provider.get_range($PROCESS),hl_scopes::instruction));

        auto op_index = $PROCESS->getTokenIndex()+1;
        $op_text = static_cast<lexing::token_stream*>(_input)->get_text_with_newlines(misc::Interval(op_index,_input->size()-1));
        $op_range = provider.get_range(_input->get(op_index),_input->get(_input->size()-1));
        $op_logical_column = static_cast<hlasm_plugin::parser_library::lexing::token*>(_input->get(op_index))->get_logical_column();
    }
    | label SPACE instruction (SPACE (~EOF)*)? EOF
    {
        if (!$instruction.ctx->exception)
        {
            auto op_index = $instruction.stop->getTokenIndex()+1;
            $op_text = static_cast<lexing::token_stream*>(_input)->get_text_with_newlines(misc::Interval(op_index,_input->size()-1));
            $op_range = provider.get_range(_input->get(op_index),_input->get(_input->size()-1));
            $op_logical_column = static_cast<hlasm_plugin::parser_library::lexing::token*>(_input->get(op_index))->get_logical_column();
        }
    }
    | SPACE
    (
        instruction (SPACE (~EOF)*)? EOF
        {
            collector.set_label_field(provider.get_empty_range( _localctx->getStart()));
            if (!$instruction.ctx->exception)
            {
                auto op_index = $instruction.stop->getTokenIndex()+1;
                $op_text = static_cast<lexing::token_stream*>(_input)->get_text_with_newlines(misc::Interval(op_index,_input->size()-1));
                $op_range = provider.get_range(_input->get(op_index),_input->get(_input->size()-1));
                $op_logical_column = static_cast<hlasm_plugin::parser_library::lexing::token*>(_input->get(op_index))->get_logical_column();
            }
        }
        |
        EOF
        {
            collector.set_label_field(provider.get_range( _localctx));
            collector.set_instruction_field(provider.get_range( _localctx));
            collector.set_operand_remark_field(provider.get_range( _localctx));
        }
    )
    | EOF
    {
        collector.set_label_field(provider.get_range( _localctx));
        collector.set_instruction_field(provider.get_range( _localctx));
        collector.set_operand_remark_field(provider.get_range( _localctx));
    };
    catch[const FailedPredicateException&]
    {
        collector.set_label_field(provider.get_range( _localctx));
        collector.set_instruction_field(provider.get_range( _localctx));
        collector.set_operand_remark_field(provider.get_range( _localctx));
    }
    catch[RecognitionException &e]
    {
        _errHandler->reportError(this, e);
        _localctx->exception = std::current_exception();
        _errHandler->recover(this, _localctx->exception);
    }

num_ch
    : NUM+;

num returns [self_def_t value]
    : num_ch                                    {$value = parse_self_def_term("D",get_context_text($num_ch.ctx),provider.get_range($num_ch.ctx));};

signed_num_ch
    : MINUS? NUM+;

id returns [id_index name, id_index using_qualifier]
    : f=id_no_dot {$name = $f.name;} (dot s=id_no_dot {$name = $s.name; $using_qualifier = $f.name;})?;

id_no_dot returns [id_index name] locals [std::string buffer]
    : ORDSYMBOL { $buffer = $ORDSYMBOL->getText(); } (l=(IDENTIFIER|NUM|ORDSYMBOL) {$buffer.append($l->getText());})*
    {
        $name = parse_identifier(std::move($buffer),provider.get_range($ORDSYMBOL,$l?$l:$ORDSYMBOL));
    }
    ;

vs_id returns [id_index name]
    : ORDSYMBOL
    {
        std::string text = $ORDSYMBOL->getText();
        auto first = $ORDSYMBOL;
        auto last = first;
    }
    (
        NUM
        {
            text += $NUM->getText();
            last = $NUM;
        }
        |
        ORDSYMBOL
        {
            text += $ORDSYMBOL->getText();
            last = $ORDSYMBOL;
        }
    )*
    {
        $name = parse_identifier(std::move(text), provider.get_range(first, last));
    };

remark
    : (DOT|ASTERISK|MINUS|PLUS|LT|GT|COMMA|LPAR|RPAR|SLASH|EQUALS|AMPERSAND|APOSTROPHE|IDENTIFIER|NUM|VERTICAL|ORDSYMBOL|SPACE|ATTR)*;

remark_o returns [std::optional<range> value]
    : SPACE remark                            {$value = provider.get_range( $remark.ctx);}
    | ;

    //***** highlighting rules
comma
    : COMMA {collector.add_hl_symbol(token_info(provider.get_range( $COMMA),hl_scopes::operator_symbol)); };
dot
    : DOT {collector.add_hl_symbol(token_info(provider.get_range( $DOT),hl_scopes::operator_symbol)); };
apostrophe
    : APOSTROPHE;
attr
    : ATTR {collector.add_hl_symbol(token_info(provider.get_range( $ATTR),hl_scopes::operator_symbol)); };
lpar
    : LPAR { collector.add_hl_symbol(token_info(provider.get_range( $LPAR),hl_scopes::operator_symbol)); };
rpar
    : RPAR {collector.add_hl_symbol(token_info(provider.get_range( $RPAR),hl_scopes::operator_symbol)); };
ampersand
    : AMPERSAND { collector.add_hl_symbol(token_info(provider.get_range( $AMPERSAND),hl_scopes::operator_symbol)); };
equals
    : EQUALS { collector.add_hl_symbol(token_info(provider.get_range( $EQUALS),hl_scopes::operator_symbol)); };
asterisk
    : ASTERISK {collector.add_hl_symbol(token_info(provider.get_range( $ASTERISK),hl_scopes::operator_symbol)); };
slash
    : SLASH { collector.add_hl_symbol(token_info(provider.get_range( $SLASH),hl_scopes::operator_symbol)); };
minus
    : MINUS {collector.add_hl_symbol(token_info(provider.get_range( $MINUS),hl_scopes::operator_symbol)); };
plus
    : PLUS {collector.add_hl_symbol(token_info(provider.get_range( $PLUS),hl_scopes::operator_symbol)); };




deferred_op_rem returns [remark_list remarks, std::vector<vs_ptr> var_list]
    :
    (
        deferred_entry
        {
            for (auto&v : $deferred_entry.vs)
                $var_list.push_back(std::move(v));
        }
    )*
    {enable_continuation();}
    remark_o {if($remark_o.value) $remarks.push_back(*$remark_o.value);}
    (
        CONTINUATION
        {disable_continuation();}
        (
            deferred_entry
            {
                for (auto&v : $deferred_entry.vs)
                    $var_list.push_back(std::move(v));
            }
        )*
        {enable_continuation();}
        remark_o {if($remark_o.value) $remarks.push_back(*$remark_o.value);}
    )*
    ;
    finally
    {disable_continuation();}

//////////////////////////////////////// ca

op_rem_body_ca_branch locals [bool pending_empty_op = false, std::vector<range> remarks, std::vector<operand_ptr> operands, antlr4::Token* first_token = nullptr]
    :
    EOF
    {
        collector.set_operand_remark_field(provider.get_range(_localctx));
    }
    |
    SPACE+
    (
        EOF
        {
            collector.set_operand_remark_field(provider.get_range($ctx->getStart(),_input->LT(-1)));
        }
        |
        {
            $first_token = _input->LT(1);
        }
        (
            comma
            {
                $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($comma.start)));
                $pending_empty_op = true;
            }
            |
            {
                $pending_empty_op = false;
            }
            ca_op=ca_op_branch
            {
                if ($ca_op.op)
                    $operands.push_back(std::move($ca_op.op));
                else
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($ca_op.start)));
            }
        )
        (
            comma
            {
                if ($pending_empty_op)
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($comma.start)));
                $pending_empty_op = true;
            }
            |
            {
                if (_input->LA(-1) == hlasmparser_multiline::COMMA)
                    enable_continuation();
            }
            (
                SPACE
                remark
                {
                    $remarks.push_back(provider.get_range($remark.ctx));
                }
                (CONTINUATION|EOF)
                |
                CONTINUATION
            )
            {
                disable_continuation();
            }
            |
            {
                if (!$pending_empty_op)
                    throw NoViableAltException(this);
            }
            ca_op=ca_op_branch
            {
                $pending_empty_op = false;
            }
            {
                if ($ca_op.op)
                    $operands.push_back(std::move($ca_op.op));
                else
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($ca_op.start)));
            }
        )*
        EOF
        {
            if ($pending_empty_op)
                $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range(_input->LT(-1))));
        }
    );
    finally
    {
        disable_continuation();
        if ($first_token)
            collector.set_operand_remark_field(std::move($operands), std::move($remarks), provider.get_range($first_token, _input->LT(-1)));
    }
op_rem_body_ca_expr locals [bool pending_empty_op = false, std::vector<range> remarks, std::vector<operand_ptr> operands, antlr4::Token* first_token = nullptr]
    :
    EOF
    {
        collector.set_operand_remark_field(provider.get_range(_localctx));
    }
    |
    SPACE+
    (
        EOF
        {
            collector.set_operand_remark_field(provider.get_range($ctx->getStart(),_input->LT(-1)));
        }
        |
        {
            $first_token = _input->LT(1);
        }
        (
            comma
            {
                $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($comma.start)));
                $pending_empty_op = true;
            }
            |
            {
                $pending_empty_op = false;
            }
            ca_op=ca_op_expr
            {
                if ($ca_op.op)
                    $operands.push_back(std::move($ca_op.op));
                else
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($ca_op.start)));
            }
        )
        (
            comma
            {
                if ($pending_empty_op)
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($comma.start)));
                $pending_empty_op = true;
            }
            |
            {
                if (_input->LA(-1) == hlasmparser_multiline::COMMA)
                    enable_continuation();
            }
            (
                SPACE
                remark
                {
                    $remarks.push_back(provider.get_range($remark.ctx));
                }
                (CONTINUATION|EOF)
                |
                CONTINUATION
            )
            {
                disable_continuation();
            }
            |
            {
                if (!$pending_empty_op)
                    throw NoViableAltException(this);
            }
            ca_op=ca_op_expr
            {
                $pending_empty_op = false;
            }
            {
                if ($ca_op.op)
                    $operands.push_back(std::move($ca_op.op));
                else
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($ca_op.start)));
            }
        )*
        EOF
        {
            if ($pending_empty_op)
                $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range(_input->LT(-1))));
        }
    );
    finally
    {
        disable_continuation();
        if ($first_token)
            collector.set_operand_remark_field(std::move($operands), std::move($remarks), provider.get_range($first_token, _input->LT(-1)));
    }
op_rem_body_ca_var_def locals [bool pending_empty_op = false, std::vector<range> remarks, std::vector<operand_ptr> operands, antlr4::Token* first_token = nullptr]
    :
    EOF
    {
        collector.set_operand_remark_field(provider.get_range(_localctx));
    }
    |
    SPACE+
    (
        EOF
        {
            collector.set_operand_remark_field(provider.get_range($ctx->getStart(),_input->LT(-1)));
        }
        |
        {
            $first_token = _input->LT(1);
        }
        (
            comma
            {
                $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($comma.start)));
                $pending_empty_op = true;
            }
            |
            {
                $pending_empty_op = false;
            }
            ca_op=ca_op_var_def
            {
                if ($ca_op.op)
                    $operands.push_back(std::move($ca_op.op));
                else
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($ca_op.start)));
            }
        )
        (
            comma
            {
                if ($pending_empty_op)
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($comma.start)));
                $pending_empty_op = true;
            }
            |
            {
                if (_input->LA(-1) == hlasmparser_multiline::COMMA)
                    enable_continuation();
            }
            (
                SPACE
                remark
                {
                    $remarks.push_back(provider.get_range($remark.ctx));
                }
                (CONTINUATION|EOF)
                |
                CONTINUATION
            )
            {
                disable_continuation();
            }
            |
            {
                if (!$pending_empty_op)
                    throw NoViableAltException(this);
            }
            ca_op=ca_op_var_def
            {
                $pending_empty_op = false;
            }
            {
                if ($ca_op.op)
                    $operands.push_back(std::move($ca_op.op));
                else
                    $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range($ca_op.start)));
            }
        )*
        EOF
        {
            if ($pending_empty_op)
                $operands.push_back(std::make_unique<semantics::empty_operand>(provider.get_empty_range(_input->LT(-1))));
        }
    );
    finally
    {
        disable_continuation();
        if ($first_token)
            collector.set_operand_remark_field(std::move($operands), std::move($remarks), provider.get_range($first_token, _input->LT(-1)));
    }
//////////////////////////////////////// mac

op_rem_body_mac returns [macop_preprocess_results results, range line_range, size_t line_logical_column = 0]
    :
    SPACE* EOF {$line_range = provider.get_range($ctx->getStart(), _input->LT(-1));}
    |
    SPACE+ op_rem_body_alt_mac[&$results]
    {
        if ($results.text_ranges.empty())
            $results.total_op_range = provider.get_empty_range($op_rem_body_alt_mac.start);
        else
            $results.total_op_range = union_range($results.text_ranges.front(), $results.text_ranges.back());
        $line_range = provider.get_range($op_rem_body_alt_mac.ctx);
        $line_logical_column = static_cast<hlasm_plugin::parser_library::lexing::token*>($op_rem_body_alt_mac.start)->get_logical_column();
    } EOF;

op_rem_body_alt_mac [macop_preprocess_results* results]
    :
    (
        mac_preproc
        {
            append_context_text($results->text, $mac_preproc.ctx);
            $results->text_ranges.push_back(provider.get_range($mac_preproc.ctx));
        }
    )?
    (
        COMMA
        {enable_continuation();}
        {
            $results->text.push_back(',');
            $results->text_ranges.push_back(provider.get_range($COMMA));
        }
        (
            remark_o (CONTINUATION | EOF)
            {
                if ($remark_o.value)
                    $results->remarks.push_back(std::move(*$remark_o.value));
            }
        )?
        {disable_continuation();}
        (
        mac_preproc
        {
            append_context_text($results->text, $mac_preproc.ctx);
            $results->text_ranges.push_back(provider.get_range($mac_preproc.ctx));
        }
        )?
    )*
    last_remark=remark_o
    {
        if ($last_remark.value)
            $results->remarks.push_back(std::move(*$last_remark.value));
    }
    ;
    finally
    {disable_continuation();}

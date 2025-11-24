/*
 * Copyright (c) 2025 Broadcom.
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

#include <array>

#include "gtest/gtest.h"

#include "../common_testing.h"
#include "diagnostic.h"

namespace {
auto test_arithmetic_external_adder()
{
    return external_functions_list {
        {
            "ADD",
            [](external_function_args& args) {
                if (auto* aarg = args.arithmetic())
                    for (auto x : aarg->args)
                        aarg->result += x;
            },
        },
    };
}

auto test_character_external_adder()
{
    return external_functions_list {
        {
            "ADD",
            [](external_function_args& args) {
                if (auto* aarg = args.character())
                    for (auto x : aarg->args)
                        aarg->result += x;
            },
        },
    };
}

auto test_counter_external()
{
    return external_functions_list {
        {
            "ADD",
            [](external_function_args& args) {
                if (auto* aarg = args.arithmetic())
                    aarg->result = static_cast<A_t>(aarg->args.size());
                if (auto* carg = args.character())
                    carg->result = std::string(carg->args.size(), 'X');
            },
        },
    };
}
} // namespace

TEST(external_functions, arithmetic)
{
    std::string input(R"(
&A  SETAF 'ADD',1,2
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    auto& ctx = a.hlasm_ctx();

    EXPECT_EQ(get_var_value<A_t>(ctx, "A"), 3);
}

TEST(external_functions, character)
{
    std::string input(R"(
&A  SETCF 'ADD','A','B'
)");
    analyzer a(input, analyzer_options(test_character_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    auto& ctx = a.hlasm_ctx();

    EXPECT_EQ(get_var_value<C_t>(ctx, "A"), "AB");
}

TEST(external_functions, message)
{
    std::string input(R"(
&A  SETAF 'MSG',1,2
)");
    analyzer a(input,
        analyzer_options(external_functions_list {
            { "MSG", [](external_function_args& args) { args.message().emplace(3, "EXTERNAL"); } },
        }));
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "EXT" }));
    EXPECT_TRUE(matches_message_text(a.diags(), { "External function MSG: EXTERNAL" }));
    EXPECT_TRUE(matches_message_properties(a.diags(), { range({ 1, 4 }, { 1, 9 }) }, &diagnostic::diag_range));
    EXPECT_TRUE(matches_message_properties(a.diags(), { diagnostic_severity::info }, &diagnostic::severity));
}

TEST(external_functions, indirect)
{
    std::string input(R"(
&F  SETC  'MSG'
&A  SETAF '&F'
)");
    analyzer a(input,
        analyzer_options(external_functions_list {
            { "MSG", [](external_function_args& args) { args.message().emplace(3, "EXTERNAL"); } },
        }));
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "EXT" }));
}

TEST(external_functions, missing_function_name)
{
    std::string input(R"(
&A  SETAF
&C  SETCF
)");
    analyzer a(input);
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "E022", "E022" }));
}

TEST(external_functions, missing_function)
{
    std::string input(R"(
&A  SETAF 'EXT'
&C  SETCF 'EXT'
)");
    analyzer a(input);
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "E083", "E083" }));
}

TEST(external_functions, function_not_a_string_1)
{
    std::string input(R"(
EXT EQU   0
&A  SETAF EXT
&C  SETCF EXT
)");
    analyzer a(input);
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "E082", "E082", "CE004", "CE004" }));
}

TEST(external_functions, function_not_a_string_2)
{
    std::string input(R"(
&A  SETA  0
&A  SETAF &A
&C  SETCF &A
)");
    analyzer a(input);
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "E082", "E082", "CE017", "CE017" }));
}

TEST(external_functions, function_not_a_string_3)
{
    std::string input(R"(
&F  SETC  'F'
&A  SETAF &F
&C  SETCF &F
)");
    analyzer a(input, analyzer_options(external_functions_list { { "F", [](auto&) {} } }));
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "CE017", "CE017" }));
}

TEST(external_functions, arithmetic_wrong_args_1)
{
    std::string input(R"(
&C  SETC  'A'
&A  SETAF 'ADD',&C
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "CE012" }));
}

TEST(external_functions, arithmetic_wrong_args_2)
{
    std::string input(R"(
&C  SETC  'A'
&A  SETAF 'ADD','&C'
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "E013", "CE004" }));
}

TEST(external_functions, arithmetic_ord_arg)
{
    std::string input(R"(
A   EQU   5
&C  SETC  'A'
&R  SETAF 'ADD',&C
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "R"), 5);
}

TEST(external_functions, arithmetic_expr_1)
{
    std::string input(R"(
&A  SETA  1
&R  SETAF 'ADD',NOT &A
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "R"), -2);
}

TEST(external_functions, arithmetic_expr_2)
{
    std::string input(R"(
&A  SETA  1
&R  SETAF 'ADD',&A+&A
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "R"), 2);
}

TEST(external_functions, arithmetic_self_reference)
{
    std::string input(R"(
&A  SETAF 'ADD',&A+&A
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "A"), 0);
}

TEST(external_functions, arithmetic_array)
{
    std::string input(R"(
&A(1) SETAF 'ADD',1,2
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_vector<A_t>(a.hlasm_ctx(), "A"), std::vector(1, 3));
}

TEST(external_functions, arithmetic_boolean)
{
    std::string input(R"(
&B  SETB  1
&A  SETAF 'ADD',&B,&B
)");
    analyzer a(input, analyzer_options(test_arithmetic_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "A"), 2);
}

TEST(external_functions, arithmetic_empty_args_1)
{
    std::string input(R"(
&A  SETAF 'ADD',
)");
    analyzer a(input, analyzer_options(test_counter_external()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "A"), 0);
}

TEST(external_functions, arithmetic_empty_args_2)
{
    std::string input(R"(
&A  SETAF 'ADD',,
)");
    analyzer a(input, analyzer_options(test_counter_external()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<A_t>(a.hlasm_ctx(), "A"), 1);
}

TEST(external_functions, character_wrong_args)
{
    std::string input(R"(
&A  SETA  5
&C  SETCF 'ADD',&A
)");
    analyzer a(input, analyzer_options(test_character_external_adder()));
    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "E013", "CE017" }));
}

TEST(external_functions, character_expr_1)
{
    std::string input(R"(
&C  SETC  'x'
&R  SETCF 'ADD',UPPER('&C')
)");
    analyzer a(input, analyzer_options(test_character_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<C_t>(a.hlasm_ctx(), "R"), "X");
}

TEST(external_functions, character_expr_2)
{
    std::string input(R"(
&C  SETC  'X'
&R  SETCF 'ADD','&C'.'&C'
)");
    analyzer a(input, analyzer_options(test_character_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<C_t>(a.hlasm_ctx(), "R"), "XX");
}

TEST(external_functions, character_self_reference)
{
    std::string input(R"(
&C  SETCF 'ADD','&C','&C'
)");
    analyzer a(input, analyzer_options(test_character_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<C_t>(a.hlasm_ctx(), "C"), "");
}

TEST(external_functions, character_array)
{
    std::string input(R"(
&C(1) SETCF 'ADD','A','B'
)");
    analyzer a(input, analyzer_options(test_character_external_adder()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_vector<C_t>(a.hlasm_ctx(), "C"), std::vector(1, std::string("AB")));
}

TEST(external_functions, character_empty_args_1)
{
    std::string input(R"(
&C  SETCF 'ADD',
)");
    analyzer a(input, analyzer_options(test_counter_external()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<C_t>(a.hlasm_ctx(), "C"), "");
}

TEST(external_functions, character_empty_args_2)
{
    std::string input(R"(
&C  SETCF 'ADD',,
)");
    analyzer a(input, analyzer_options(test_counter_external()));
    a.analyze();

    EXPECT_TRUE(a.diags().empty());

    EXPECT_EQ(get_var_value<C_t>(a.hlasm_ctx(), "C"), "X");
}

TEST(external_functions, unique_names)
{
    EXPECT_THROW(
        {
            analyzer a("",
                analyzer_options(external_functions_list {
                    { "a", [](auto&) {} },
                    { "A", [](auto&) {} },
                }));
        },
        std::logic_error);
}

TEST(external_functions, truncated_output)
{
    analyzer a("&C SETCF 'A'",
        analyzer_options(external_functions_list {
            { "A",
                [](external_function_args& args) {
                    if (auto* cargs = args.character())
                        cargs->result = std::string(4096, 'X');
                } },
        }));

    a.analyze();

    EXPECT_TRUE(matches_message_codes(a.diags(), { "W019" }));
}

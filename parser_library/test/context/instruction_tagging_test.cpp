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

#include "gtest/gtest.h"

#include "../common_testing.h"
#include "../mock_parse_lib_provider.h"

TEST(instruction_tagging, basic)
{
    std::string input = R"(
        SAM31:ASM 1
        SAM31:MAC 2
)";

    std::string macro = R"( MACRO
        SAM31 &P
        MNOTE 'MACRO &P'
        MEND
)";
    mock_parse_lib_provider lib_provider { { "SAM31", macro } };

    analyzer a(input, analyzer_options { &lib_provider });
    a.analyze();
    EXPECT_TRUE(matches_message_text(a.diags(), { "MACRO 2" }));
}

TEST(instruction_tagging, multiple_tags_1)
{
    std::string input = R"(
        SAM31:MAC:ASM
)";

    std::string macro = R"( MACRO
        SAM31 &P
        MNOTE 'MACRO &P'
        MEND
)";
    mock_parse_lib_provider lib_provider { { "SAM31", macro } };

    analyzer a(input, analyzer_options { &lib_provider });
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "E049" }));
}

TEST(instruction_tagging, multiple_tags_2)
{
    std::string input = R"(
        SAM31:ASM:MAC
)";

    std::string macro = R"( MACRO
        SAM31 &P
        MNOTE 'MACRO &P'
        MEND
)";
    mock_parse_lib_provider lib_provider { { "SAM31", macro } };

    analyzer a(input, analyzer_options { &lib_provider });
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "E049" }));
}

TEST(instruction_tagging, macro_redefinition)
{
    std::string input = R"(
        SAM31:ASM
        SAM31:MAC 1

        MACRO
        SAM31
        MNOTE 'HELLO'
        MEND

        SAM31:MAC 2
)";

    std::string macro = R"( MACRO
        SAM31 &P
        MNOTE 'MACRO &P'
        MEND
)";
    mock_parse_lib_provider lib_provider { { "SAM31", macro } };

    analyzer a(input, analyzer_options { &lib_provider });
    a.analyze();
    EXPECT_TRUE(matches_message_text(a.diags(), { "MACRO 1", "HELLO" }));
}

TEST(instruction_tagging, ca_tag)
{
    std::string input = R"(
      AGO:ASM .TEST
.TEST ANOP    ,
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(a.diags().empty());
}

TEST(instruction_tagging, tagged_name)
{
    std::string input = R"(
        SAM31:MAC 1

        MACRO
        SAM31:MAC
        MNOTE 'HELLO'
        MEND

        SAM31:MAC 2
)";

    std::string macro = R"( MACRO
        SAM31 &P
        MNOTE 'MACRO &P'
        MEND
)";
    mock_parse_lib_provider lib_provider { { "SAM31", macro } };

    analyzer a(input, analyzer_options { &lib_provider });
    a.analyze();
    EXPECT_TRUE(matches_message_text(a.diags(), { "MACRO 1", "HELLO" }));
}

TEST(instruction_tagging, no_double_tagging)
{
    std::string input = R"(
        MACRO
        SAM31:MAC
        MNOTE 'HELLO'
        MEND

        SAM31:MAC:MAC
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "E049" }));
}

TEST(instruction_tagging, invalid_tag)
{
    std::string input = R"(
        SAM31:BLA
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "E049" }));
}

TEST(instruction_tagging, not_a_tag)
{
    std::string input = R"(
        MACRO
        SAM31:BLA
        MNOTE 'HELLO'
        MEND
        SAM31:BLA
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(matches_message_text(a.diags(), { "HELLO" }));
}

TEST(instruction_tagging, tagged_not_a_tag)
{
    std::string input = R"(
        MACRO
        SAM31:BLA
        MNOTE 'HELLO'
        MEND
        SAM31:BLA:MAC
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(matches_message_text(a.diags(), { "HELLO" }));
}

TEST(instruction_tagging, tag_without_instruction)
{
    std::string input = R"(
        :BLA
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "E049" }));
}

TEST(instruction_tagging, opsyn_interaction)
{
    std::string input = R"(
    SAM31:ASM
    SAM31:MAC
          
I1  OPSYN SAM31:ASM
I2  OPSYN SAM31:MAC
SAM31:ASM OPSYN
SAM31:MAC OPSYN
)";

    std::string macro = R"( MACRO
        SAM31
        MEND
)";
    mock_parse_lib_provider lib_provider { { "SAM31", macro } };

    analyzer a(input, analyzer_options { &lib_provider });
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "S0002", "S0002", "E057", "E057" }));
}

TEST(instruction_tagging, disallow_asm_override_1)
{
    std::string input = R"(
    MACRO
    SAM31:ASM
    MNOTE 'HELLO'
    MEND
    SAM31:ASM
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(a.diags().empty());
}

TEST(instruction_tagging, disallow_asm_override_2)
{
    std::string input = R"(
    MACRO
    SAM31:ASM
    MNOTE 'HELLO'
    MEND
    SAM31:ASM:MAC
)";
    analyzer a(input);
    a.analyze();
    EXPECT_TRUE(matches_message_codes(a.diags(), { "E049" }));
}

---
to: <%= name %>/test_strings.json
---
{
    "about this file": [
        "This file is used by src/__integration_tests__/integration.test.ts",
        "Each entry in here is an array of two strings.",
        "The first string (<string1>) is intended to be the value input for the 'hygen-create usename <string1>' command",
        "The second (<string2>) is the expected value after running the resulting generator with --name <string2>"
    ],
    "about the sections": [
        "Each section has a 'defs' entry with two definitions:  'hygen-create usename' and 'hygen --name",
        "When the following command sequence is run:",
            "  $ hygen-create start test-generator",
            "  $ hygen-create usename <hygen-create-usename from the defs section>",
            "  $ hygen-create add test_strings.json",
            "  $ hygen-create generate",
            "  $ hygen test-generator new --name <hygen-name from the defs section>",
            "The expected result in the created file:",
            "  The first string is expected to become identical to the second",
            "  The second string should remain as it was in the original file"
    ],
    "plain": {
        "defs": {
            "hygen-create usename": "<%= name.toLowerCase() %>",
            "hygen --name": "result"
        },
        "comparisons": {
            "plain": ["<%= name.toLowerCase() %>", "result"],
            "capitalized": ["<%= h.capitalize(name) %>", "Result"],
            "allcaps": ["<%= name.toUpperCase() %>", "RESULT"],
            "with_preceding_underscore": ["_<%= name.toLowerCase() %>", "_result"],
            "with_preceding_underscore_capitalized": ["_<%= h.capitalize(name) %>", "_Result"],
            "with_preceding_dash": ["-<%= name.toLowerCase() %>", "-result"],
            "with_preceding_dash_capitalized": ["-<%= h.capitalize(name) %>", "-Result"],
            "with_preceding_<%= name.toLowerCase() %>_capitalized": ["ClsWord","ClsWord", "not converted"]
        }
    },
    "doubled-no-sfx": {
        "defs": {
            "hygen-create usename": "DoubleWord",
            "hygen --name": "TheResult"
        },
        "comparisons": {
            "underscore": ["double_<%= name.toLowerCase() %>","the_result"],
            "underscore_with_preceding_underscore": ["_double_<%= name.toLowerCase() %>","_the_result"],
            "camelcased": ["DoubleWord","TheResult"],
            "camelcased_with_preceding_underscore": ["_DoubleWord", "_TheResult"],
            "camelcased_lowerfirst": ["doubleWord", "theResult"],
            "dashed": ["double-<%= name.toLowerCase() %>", "the-result"],
            "dashed_with_preceding_dash": ["-double-<%= name.toLowerCase() %>", "-the-result"],
            "underscore_all_caps": ["DOUBLE_<%= name.toUpperCase() %>", "THE_RESULT"]
        }
    },
    "doubled-with-sfx": {
        "defs": {
            "hygen-create usename": "DoubleWord",
            "hygen --name": "TheResult"
        },
        "comparisons": {
            "underscore": ["double_<%= name.toLowerCase() %>_with_sfx","the_result_with_sfx"],
            "underscore_with_preceding_underscore": ["_double_<%= name.toLowerCase() %>_with_sfx","_the_result_with_sfx"],
            "camelcased": ["DoubleWordWithSfx","TheResultWithSfx"],
            "camelcased_with_preceding_underscore": ["_DoubleWordWithSfx","_TheResultWithSfx"],
            "camelcased_lowerfirst": ["doubleWordWithSfx","theResultWithSfx"],
            "dashed": ["double-<%= name.toLowerCase() %>-with-sfx","the-result-with-sfx"],
            "dashed_with_preceding_dash": ["-double-<%= name.toLowerCase() %>-with-sfx","-the-result-with-sfx"],
            "underscore_all_caps": ["DOUBLE_<%= name.toUpperCase() %>_WITH_SFX","THE_RESULT_WITH_SFX"]
        }
    }
}
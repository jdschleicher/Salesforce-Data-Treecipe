/*
    The YAML half of writing an untrusted picklist value into a recipe. Each backend owns the half
    that is its expression language (a JS string for faker-js, a Jinja string for snowfakery); this
    owns what both share, because the recipe FILE is YAML in either backend.

    Two parsers read that file and they disagree about what ends a line: js-yaml (faker-js) breaks
    only at \n and \r, while PyYAML (snowfakery) also breaks at U+0085, U+2028 and U+2029. A value is
    only inert if NEITHER parser sees a break in it, so both sets are escaped everywhere.
*/
export class RecipeYamlScalar {

    // LINE BREAKS FOR EITHER PARSER, EVERY OTHER CHARACTER PyYAML REFUSES IN A STREAM, AND TAB, WHICH YAML READS AS SEPARATING WHITESPACE
    static readonly nonPrintableCharacterPattern = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g;

    static readonly yamlIndicatorFirstCharacters = '-?:,[]{}#&*!|>\'"%@`';

    /*
        \n and \r keep their short forms; everything else becomes \uXXXX, which a JS string literal,
        a Jinja (Python) string literal and a YAML double-quoted scalar all read back identically.
    */
    static escapeNonPrintableCharacters(text: string): string {

        return text.replace(RecipeYamlScalar.nonPrintableCharacterPattern, (character: string) => {

            if ( character === '\n' ) {
                return '\\n';
            }
            if ( character === '\r' ) {
                return '\\r';
            }
            return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;

        });

    }

    static readonly nonPrintableCharacterTest = new RegExp(RecipeYamlScalar.nonPrintableCharacterPattern.source);

    /*
        What a PLAIN scalar must not contain. ": " and " #" end it early; the rest are the template
        delimiters snowfakery renders in a plain string: "${{" and "${%", and -- in its default
        snowfakery_version 2 -- a second, legacy Jinja environment's "<<" and "<%". "${", "{{" and "{%"
        are wider than any delimiter on purpose.
    */
    static readonly plainScalarUnsafeSequences = [': ', ' #', '${', '{{', '{%', '<<', '<%'];

    /*
        A plain scalar YAML reads as something other than a string: a boolean, null or number under
        YAML 1.1 (PyYAML, snowfakery) or 1.2 (js-yaml, faker-js). A "Yes" / "No" dependent picklist
        would otherwise come back as True / False, and "007" as 7. Anything starting like a number is
        included, which also covers timestamps, octal, hex and sexagesimal.
    */
    static readonly nonStringPlainScalarPattern = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~|=|[-+]?\.?[0-9].*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

    /*
        Conservative on purpose: anything this rejects is quoted, which costs only looks. A value it
        wrongly accepted could change the recipe's structure, come back as a different type, or be
        read by snowfakery as a template.
    */
    static isSafeAsPlainScalar(value: string): boolean {

        if ( value.length === 0 || value.trim() !== value ) {
            return false;
        }
        if ( RecipeYamlScalar.yamlIndicatorFirstCharacters.includes(value[0]) ) {
            return false;
        }
        if ( RecipeYamlScalar.nonPrintableCharacterTest.test(value) ) {
            return false;
        }
        if ( RecipeYamlScalar.nonStringPlainScalarPattern.test(value) ) {
            return false;
        }
        if ( RecipeYamlScalar.plainScalarUnsafeSequences.some(sequence => value.includes(sequence)) || value.endsWith(':') ) {
            return false;
        }

        return true;

    }

    static toDoubleQuotedScalar(value: string): string {

        const escapedValue = RecipeYamlScalar.escapeNonPrintableCharacters(
            value
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
        );
        return `"${escapedValue}"`;

    }

    /*
        A comment is inert to both parsers until a line break ends it, so a value written into one
        only needs its breaks (and the characters PyYAML refuses) escaped. Nothing else changes, so
        an ordinary value reads exactly as it did.
    */
    static escapeForComment(value: string): string {

        return RecipeYamlScalar.escapeNonPrintableCharacters(String(value));

    }

    /*
        A notification is not plain text: VS Code renders "[label](command:...)" in one as a link that
        runs the command, and workspace text shown in one is text the repository chose. Brackets and
        parentheses are escaped along with line breaks, so no value can form a link.
    */
    static escapeForNotification(value: string): string {

        return RecipeYamlScalar.escapeForComment(String(value ?? ''))
            .replace(/[[\]()]/g, (character: string) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

    }

}

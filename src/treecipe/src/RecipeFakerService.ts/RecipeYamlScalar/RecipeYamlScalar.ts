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

    /*
        Conservative on purpose: anything this rejects is quoted, which costs only looks. A value it
        wrongly accepted could change the recipe's structure, or -- where it carries "${" -- be read
        by snowfakery as a template.
    */
    static isSafeAsPlainScalar(value: string): boolean {

        if ( value.length === 0 || value.trim() !== value ) {
            return false;
        }
        if ( RecipeYamlScalar.yamlIndicatorFirstCharacters.includes(value[0]) ) {
            return false;
        }
        if ( new RegExp(RecipeYamlScalar.nonPrintableCharacterPattern.source).test(value) ) {
            return false;
        }

        const structuralSequences = [': ', ' #', '${', '{{', '{%'];
        if ( structuralSequences.some(sequence => value.includes(sequence)) || value.endsWith(':') ) {
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

}

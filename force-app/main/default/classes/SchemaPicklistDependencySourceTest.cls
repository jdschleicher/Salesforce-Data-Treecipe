/**
 * Covers the describe-based source's bitmap decoding and its error paths.
 *
 * The decode is pure and org-independent, so it is asserted directly. The fetch paths
 * asserted here are the ones that fail before touching org-specific metadata; end-to-end
 * decoding against a real dependent picklist is verified by the anonymous Apex runner,
 * since no org is guaranteed to have one.
 */
@IsTest
private class SchemaPicklistDependencySourceTest {

    @IsTest
    static void decodesASingleSetBitToItsControllingValueIndex() {
        // "gAAA" -> 0x80 0x00 0x00 -> only the high bit of the first byte
        Assert.areEqual(
            new List<Integer>{ 0 },
            SchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 3)
        );
    }

    @IsTest
    static void decodesTheSecondControllingValueIndex() {
        // "QAAA" -> 0x40 0x00 0x00 -> second-highest bit
        Assert.areEqual(
            new List<Integer>{ 1 },
            SchemaPicklistDependencySource.decodeValidForIndexes('QAAA', 3)
        );
    }

    @IsTest
    static void decodesMultipleSetBits() {
        // "wAAA" -> 0xC0 0x00 0x00 -> the two highest bits
        Assert.areEqual(
            new List<Integer>{ 0, 1 },
            SchemaPicklistDependencySource.decodeValidForIndexes('wAAA', 3)
        );
    }

    @IsTest
    static void decodesBitsBeyondTheFirstByte() {
        // "AIAA" -> 0x00 0x80 0x00 -> the high bit of the SECOND byte, i.e. index 8
        Assert.areEqual(
            new List<Integer>{ 8 },
            SchemaPicklistDependencySource.decodeValidForIndexes('AIAA', 12)
        );
    }

    @IsTest
    static void ignoresPaddingBitsBeyondTheControllingValueCount() {
        // Only two controlling values exist, so the bit at index 2 is padding
        Assert.areEqual(
            new List<Integer>{ 0, 1 },
            SchemaPicklistDependencySource.decodeValidForIndexes('4AAA', 2)
        );
    }

    @IsTest
    static void treatsANonDependentPicklistAsValidForNothing() {
        Assert.areEqual(
            new List<Integer>(),
            SchemaPicklistDependencySource.decodeValidForIndexes(null, 3),
            'a null validFor means the field is not dependent, not an error'
        );
        Assert.areEqual(
            new List<Integer>(),
            SchemaPicklistDependencySource.decodeValidForIndexes('', 3)
        );
    }

    @IsTest
    static void decodesNothingWhenThereAreNoControllingValues() {
        Assert.areEqual(
            new List<Integer>(),
            SchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 0)
        );
    }

    @IsTest
    static void stopsAtTheEndOfAShortBitmapInsteadOfThrowing() {
        Assert.areEqual(
            new List<Integer>{ 0 },
            SchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 999)
        );
    }

    /**
     * Guards an inversion that would silently swap every result for a checkbox-controlled
     * picklist. Verified in a live org: with Gold/Silver requiring the checkbox CHECKED and
     * Direct requiring it UNCHECKED, Gold and Silver serialize validFor as "QAAA" (bit 1)
     * and Direct as "gAAA" (bit 0). The UI API agrees — controllerValues {"false":0,"true":1}.
     */
    @IsTest
    static void checkboxControllingValuesAreOrderedFalseThenTrue() {

        Schema.DescribeFieldResult booleanField = Schema.getGlobalDescribe()
            .get('Account')
            .getDescribe()
            .fields.getMap()
            .get('IsDeleted')
            .getDescribe();

        Assert.areEqual(Schema.DisplayType.BOOLEAN, booleanField.getType(), 'precondition: IsDeleted is a checkbox');

        Assert.areEqual(
            new List<String>{ 'false', 'true' },
            SchemaPicklistDependencySource.controllingValuesInIndexOrder(booleanField),
            'false must be index 0 and true index 1; reversing this inverts every checkbox-controlled result'
        );
    }

    @IsTest
    static void checkboxIndexOrderDecodesTheSameWayTheOrgReportsIt() {

        // "QAAA" is what a value requiring the checkbox CHECKED serializes as in a live org
        Assert.areEqual(
            new List<Integer>{ 1 },
            SchemaPicklistDependencySource.decodeValidForIndexes('QAAA', 2),
            'a checked-only value decodes to index 1, which is "true" in controllingValuesInIndexOrder'
        );

        // "gAAA" is what a value requiring the checkbox UNCHECKED serializes as
        Assert.areEqual(
            new List<Integer>{ 0 },
            SchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 2),
            'an unchecked-only value decodes to index 0, which is "false"'
        );
    }

    @IsTest
    static void picklistControllingValuesKeepTheirDescribeOrder() {

        Schema.DescribeFieldResult industry = Schema.getGlobalDescribe()
            .get('Account')
            .getDescribe()
            .fields.getMap()
            .get('Industry')
            .getDescribe();

        List<String> expected = new List<String>();
        for (Schema.PicklistEntry entry : industry.getPicklistValues()) {
            expected.add(entry.getValue());
        }

        Assert.areEqual(
            expected,
            SchemaPicklistDependencySource.controllingValuesInIndexOrder(industry),
            'index order must be getPicklistValues() order — that is what validFor bits refer to'
        );
    }

    @IsTest
    static void nonDependentPicklistSerializesValidForAsNull() {
        Schema.PicklistEntry industryEntry = Account.Industry.getDescribe().getPicklistValues()[0];
        Assert.isNull(
            SchemaPicklistDependencySource.validForOf(industryEntry),
            'a standard non-dependent picklist should serialize validFor as null'
        );
    }

    @IsTest
    static void unknownObjectIsReportedByName() {

        PicklistDependencySpec spec =
            PicklistDependencySpec.forField('Treecipe_Not_A_Real_Object__c', 'Whatever__c');

        try {
            new SchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected an unknown object to be rejected');
        } catch (SchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('Treecipe_Not_A_Real_Object__c'), e.getMessage());
        }
    }

    @IsTest
    static void missingFieldMentionsFieldLevelSecurity() {

        PicklistDependencySpec spec =
            PicklistDependencySpec.forField('Account', 'Treecipe_Not_A_Real_Field__c');

        try {
            new SchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected an unknown field to be rejected');
        } catch (SchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(
                e.getMessage().contains('field-level security'),
                'an invisible field is absent from describe, so the message must say so: ' + e.getMessage()
            );
        }
    }

    @IsTest
    static void nonDependentFieldIsRejectedRatherThanReportedAsEmpty() {

        PicklistDependencySpec spec = PicklistDependencySpec.forField('Account', 'Industry');

        try {
            new SchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected a non-dependent picklist to be rejected');
        } catch (SchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('not a dependent picklist'), e.getMessage());
        }
    }
}

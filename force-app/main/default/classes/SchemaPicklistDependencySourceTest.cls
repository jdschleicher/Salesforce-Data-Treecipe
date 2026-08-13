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

    @IsTest
    static void nonDependentPicklistSerializesValidForAsNull() {
        Schema.PicklistEntry industryEntry = Account.Industry.getDescribe().getPicklistValues()[0];
        Assert.isNull(
            SchemaPicklistDependencySource.validForOf(industryEntry),
            'a standard non-dependent picklist should serialize validFor as null'
        );
    }

    @IsTest
    static void recordTypeScopedSpecsAreRejectedWithAnActionableMessage() {

        PicklistDependencySpec spec = PicklistDependencySpec.forField('Account', 'Industry')
            .forRecordType('Some_Record_Type')
            .expectAtLeast('Anything', new List<String>{ 'Value' });

        try {
            new SchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected a record-type-scoped spec to be rejected');
        } catch (SchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(
                e.getMessage().contains('forRecordType'),
                'the message should name the call to remove: ' + e.getMessage()
            );
        }
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

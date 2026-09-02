/**
 * Covers the describe-based source's bitmap decoding and its error paths.
 *
 * The decode is pure and org-independent, so it is asserted directly. The fetch paths
 * asserted here are the ones that fail before touching org-specific metadata; end-to-end
 * decoding against a real dependent picklist is verified by the anonymous Apex runner,
 * since no org is guaranteed to have one.
 */
@IsTest
private class SDTSchemaPicklistDependencySourceTest {

    @IsTest
    static void decodesASingleSetBitToItsControllingValueIndex() {
        // "gAAA" -> 0x80 0x00 0x00 -> only the high bit of the first byte
        Assert.areEqual(
            new List<Integer>{ 0 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 3)
        );
    }

    @IsTest
    static void decodesTheSecondControllingValueIndex() {
        // "QAAA" -> 0x40 0x00 0x00 -> second-highest bit
        Assert.areEqual(
            new List<Integer>{ 1 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('QAAA', 3)
        );
    }

    @IsTest
    static void decodesMultipleSetBits() {
        // "wAAA" -> 0xC0 0x00 0x00 -> the two highest bits
        Assert.areEqual(
            new List<Integer>{ 0, 1 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('wAAA', 3)
        );
    }

    @IsTest
    static void decodesBitsBeyondTheFirstByte() {
        // "AIAA" -> 0x00 0x80 0x00 -> the high bit of the SECOND byte, i.e. index 8
        Assert.areEqual(
            new List<Integer>{ 8 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('AIAA', 12)
        );
    }

    @IsTest
    static void ignoresPaddingBitsBeyondTheControllingValueCount() {
        // Only two controlling values exist, so the bit at index 2 is padding
        Assert.areEqual(
            new List<Integer>{ 0, 1 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('4AAA', 2)
        );
    }

    @IsTest
    static void treatsANonDependentPicklistAsValidForNothing() {
        Assert.areEqual(
            new List<Integer>(),
            SDTSchemaPicklistDependencySource.decodeValidForIndexes(null, 3),
            'a null validFor means the field is not dependent, not an error'
        );
        Assert.areEqual(
            new List<Integer>(),
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('', 3)
        );
    }

    @IsTest
    static void decodesNothingWhenThereAreNoControllingValues() {
        Assert.areEqual(
            new List<Integer>(),
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 0)
        );
    }

    @IsTest
    static void stopsAtTheEndOfAShortBitmapInsteadOfThrowing() {
        Assert.areEqual(
            new List<Integer>{ 0 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 999)
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
            SDTSchemaPicklistDependencySource.controllingValuesInIndexOrder(booleanField),
            'false must be index 0 and true index 1; reversing this inverts every checkbox-controlled result'
        );
    }

    @IsTest
    static void checkboxIndexOrderDecodesTheSameWayTheOrgReportsIt() {

        // "QAAA" is what a value requiring the checkbox CHECKED serializes as in a live org
        Assert.areEqual(
            new List<Integer>{ 1 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('QAAA', 2),
            'a checked-only value decodes to index 1, which is "true" in controllingValuesInIndexOrder'
        );

        // "gAAA" is what a value requiring the checkbox UNCHECKED serializes as
        Assert.areEqual(
            new List<Integer>{ 0 },
            SDTSchemaPicklistDependencySource.decodeValidForIndexes('gAAA', 2),
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
            SDTSchemaPicklistDependencySource.controllingValuesInIndexOrder(industry),
            'index order must be getPicklistValues() order — that is what validFor bits refer to'
        );
    }

    @IsTest
    static void nonDependentPicklistSerializesValidForAsNull() {
        Schema.PicklistEntry industryEntry = Account.Industry.getDescribe().getPicklistValues()[0];
        Assert.isNull(
            SDTSchemaPicklistDependencySource.validForOf(industryEntry),
            'a standard non-dependent picklist should serialize validFor as null'
        );
    }

    /**
     * Describe lookups are cached in static maps for the life of the transaction, which is
     * how a many-spec run stays inside the CPU limit. A cache that returned a stale or wrong
     * describe on the second read would corrupt every spec after the first, so the repeat
     * paths are asserted directly — including the failure paths, which must not be poisoned
     * into passing (or into failing differently) by a cached neighbour.
     */
    @IsTest
    static void repeatedFetchesReturnConsistentResultsThroughTheDescribeCache() {

        SDTSchemaPicklistDependencySource source = new SDTSchemaPicklistDependencySource();
        SDTPicklistDependencySpec industry = SDTPicklistDependencySpec.forField('Account', 'Industry');

        for (Integer attempt = 0; attempt < 2; attempt++) {
            try {
                source.fetch(industry);
                Assert.fail('attempt ' + attempt + ': a non-dependent picklist must be rejected every time');
            } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
                Assert.isTrue(e.getMessage().contains('not a dependent picklist'), e.getMessage());
            }
        }
    }

    /**
     * The cache must return the field that was ASKED FOR, which the repeat-path test above
     * does not prove — it only asserts a controller is still null, and almost any cache-bleed
     * bug satisfies that. If the describe key were ever reduced to the object alone (a
     * plausible slip, since the field map is keyed exactly that way), every field on Account
     * would collapse onto one describe and the other tests would still pass.
     *
     * Asserting getName() per field pins identity directly.
     */
    @IsTest
    static void cachedDescribesDoNotBleedBetweenFieldsOnTheSameObject() {

        List<String> fieldNames = new List<String>{ 'Industry', 'Type', 'Name' };

        // Twice: the first pass populates the cache, the second reads back through it
        for (Integer pass = 0; pass < 2; pass++) {
            for (String fieldName : fieldNames) {
                Schema.DescribeFieldResult describe =
                    SDTSchemaPicklistDependencySource.describeField('Account', fieldName);
                Assert.areEqual(
                    fieldName,
                    describe.getName(),
                    'pass ' + pass + ': Account.' + fieldName + ' resolved to a different field\'s describe'
                );
            }
        }
    }

    /**
     * The object-level cache key is lower-cased because Apex maps compare case-sensitively
     * while describe resolves case-insensitively. Differing casing must reach one cache entry
     * and one describe, not two.
     */
    @IsTest
    static void objectCacheKeyIsCaseInsensitive() {

        Schema.DescribeFieldResult canonical =
            SDTSchemaPicklistDependencySource.describeField('Account', 'Industry');
        Schema.DescribeFieldResult lowerCased =
            SDTSchemaPicklistDependencySource.describeField('account', 'industry');

        Assert.areEqual(
            canonical.getName(),
            lowerCased.getName(),
            'differing API-name casing must resolve to the same field describe'
        );
    }

    /**
     * clearCaches exists so a future FLS-variant test can switch running user with
     * System.runAs without silently asserting against the previous user's cached describe.
     */
    @IsTest
    static void clearCachesForcesAColdResolveWithoutChangingResults() {

        Schema.DescribeFieldResult warm =
            SDTSchemaPicklistDependencySource.describeField('Account', 'Industry');

        SDTSchemaPicklistDependencySource.clearCaches();

        Schema.DescribeFieldResult cold =
            SDTSchemaPicklistDependencySource.describeField('Account', 'Industry');

        Assert.areEqual(warm.getName(), cold.getName(), 'a cold resolve must agree with the warm one');

        // The error paths must still behave after a clear
        try {
            SDTSchemaPicklistDependencySource.describeField('Treecipe_Not_A_Real_Object__c', 'Whatever__c');
            Assert.fail('an unknown object must still be rejected after clearCaches');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('Treecipe_Not_A_Real_Object__c'), e.getMessage());
        }
    }

    @IsTest
    static void cachingOneObjectDoesNotMaskAnUnknownObjectOrField() {

        SDTSchemaPicklistDependencySource source = new SDTSchemaPicklistDependencySource();

        // Warm the Account entry in both caches first. Asserted rather than swallowed: if this
        // ever stopped reaching describeField, the checks below would run against a cold cache
        // and still pass while testing nothing.
        try {
            source.fetch(SDTPicklistDependencySpec.forField('Account', 'Industry'));
            Assert.fail('precondition: Industry is not dependent and should have thrown');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('not a dependent picklist'), e.getMessage());
        }

        try {
            source.fetch(SDTPicklistDependencySpec.forField('Account', 'Treecipe_Not_A_Real_Field__c'));
            Assert.fail('a cached object must still reject an unknown field on it');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('field-level security'), e.getMessage());
        }

        try {
            source.fetch(SDTPicklistDependencySpec.forField('Treecipe_Not_A_Real_Object__c', 'Industry'));
            Assert.fail('a warmed cache must still reject an unknown object');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('Treecipe_Not_A_Real_Object__c'), e.getMessage());
        }
    }

    @IsTest
    static void unknownObjectIsReportedByName() {

        SDTPicklistDependencySpec spec =
            SDTPicklistDependencySpec.forField('Treecipe_Not_A_Real_Object__c', 'Whatever__c');

        try {
            new SDTSchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected an unknown object to be rejected');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('Treecipe_Not_A_Real_Object__c'), e.getMessage());
        }
    }

    @IsTest
    static void missingFieldMentionsFieldLevelSecurity() {

        SDTPicklistDependencySpec spec =
            SDTPicklistDependencySpec.forField('Account', 'Treecipe_Not_A_Real_Field__c');

        try {
            new SDTSchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected an unknown field to be rejected');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(
                e.getMessage().contains('field-level security'),
                'an invisible field is absent from describe, so the message must say so: ' + e.getMessage()
            );
        }
    }

    @IsTest
    static void nonDependentFieldIsRejectedRatherThanReportedAsEmpty() {

        SDTPicklistDependencySpec spec = SDTPicklistDependencySpec.forField('Account', 'Industry');

        try {
            new SDTSchemaPicklistDependencySource().fetch(spec);
            Assert.fail('expected a non-dependent picklist to be rejected');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('not a dependent picklist'), e.getMessage());
        }
    }

    /**
     * Describe has no record type filtering, so a record type scoped spec must be refused rather
     * than answered with the whole field's values -- that answer would report a record type scope
     * as verified when nothing about it was checked.
     */
    @IsTest
    static void recordTypeScopedSpecIsRejectedRatherThanAnsweredWithFieldLevelData() {

        SDTSchemaPicklistDependencySource source = new SDTSchemaPicklistDependencySource();

        try {
            source.fetch(SDTPicklistDependencySpec.forRecordType('Account', 'Industry', 'Some_Record_Type'));
            Assert.fail('a record type scoped spec must be rejected by the describe based source');
        } catch (SDTSchemaPicklistDependencySource.PicklistDependencyException e) {
            Assert.isTrue(e.getMessage().contains('record type scoped'), e.getMessage());
            Assert.isTrue(e.getMessage().contains('Some_Record_Type'), e.getMessage());
        }
    }
}

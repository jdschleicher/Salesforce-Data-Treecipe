/**
 * Registry of picklist dependency specs to assert against an org.
 *
 * This class is hand-written today and is the target of the "Generate Picklist Dependency
 * Tests" command (issue #61), which will overwrite all() with expectAtLeast lines derived
 * from source metadata. Until then, add specs manually.
 *
 * The generator emits expectAtLeast (source combinations must still exist, org-added
 * values tolerated); tightening a line to expectExactly is a deliberate edit by the owner.
 *
 * Example of a hand-written spec:
 *
 *   return new List<PicklistDependencySpec>{
 *       PicklistDependencySpec.forField('Account', 'Region__c')
 *           .controlledBy('Country__c')
 *           .expectAtLeast('United States', new List<String>{ 'West', 'East' })
 *           .expectAtLeast('Canada', new List<String>{ 'Ontario', 'Quebec' })
 *           .expectNone('Antarctica')
 *   };
 */
public class PicklistDependencySpecs {

    public static List<PicklistDependencySpec> all() {
        return new List<PicklistDependencySpec>();
    }
}

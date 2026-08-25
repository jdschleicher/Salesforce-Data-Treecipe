/**
 * Registry of picklist dependency specs to assert against an org.
 *
 * This placeholder is what ships in the repository. The "Generate Picklist Dependency Tests"
 * command overwrites it with one method per dependent picklist found in local source metadata,
 * plus an all() that returns the collection of them.
 *
 * The generator emits expectAtLeast (source combinations must still exist, org-added values
 * tolerated); tightening a line to expectExactly is a deliberate edit by the owner, and is lost
 * on regeneration.
 *
 * Generated shape:
 *
 *   public static PicklistDependencySpec specFor_Account_Region_c() {
 *       return PicklistDependencySpec.forField('Account', 'Region__c')
 *               .controlledBy('Country__c')
 *               .expectAtLeast('United States', new List<String>{ 'West', 'East' })
 *               .expectNone('Antarctica');
 *   }
 *
 *   public static List<PicklistDependencySpec> all() {
 *       return new List<PicklistDependencySpec>{
 *           specFor_Account_Region_c()
 *       };
 *   }
 *
 * One method per scenario means a single dependency can be read on its own, referenced by name
 * from a hand-written test, or tightened without picking through one long expression.
 */
public class SFTreecipePicklistDependencySpecs {

    public static List<PicklistDependencySpec> all() {
        return new List<PicklistDependencySpec>();
    }
}

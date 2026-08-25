/**
 * Aggregator for the picklist dependency specs to assert against an org.
 *
 * This placeholder is what ships in the repository. The "Generate Picklist Dependency Tests"
 * command overwrites it with an all() that pulls in one generated class per object --
 * SDTPicklistDependencySpecs_Account, SDTPicklistDependencySpecs_Order_c and so on -- each
 * carrying one method per dependent picklist on that object.
 *
 * Callers depend on this class rather than on the per-object ones, so a class appearing or
 * disappearing as metadata changes does not ripple outwards.
 *
 * Generated shape:
 *
 *   // SDTPicklistDependencySpecs_Account.cls
 *   public static SDTPicklistDependencySpec specFor_Account_Region_c() {
 *       return SDTPicklistDependencySpec.forField('Account', 'Region__c')
 *               .controlledBy('Country__c')
 *               .expectAtLeast('United States', new List<String>{ 'West', 'East' })
 *               .expectNotAllowed('United States', new List<String>{ 'Ontario', 'Quebec' })
 *               .expectNone('Antarctica');
 *   }
 *
 *   // SDTPicklistDependencySpecs.cls
 *   public static List<SDTPicklistDependencySpec> all() {
 *       List<SDTPicklistDependencySpec> specs = new List<SDTPicklistDependencySpec>();
 *       specs.addAll(SDTPicklistDependencySpecs_Account.all());
 *       return specs;
 *   }
 *
 * Each combination is asserted twice. expectAtLeast requires the values source metadata says the
 * controlling value unlocks, tolerating any the org has added since; expectNotAllowed requires the
 * complement to stay locked, which is what catches a value drifting into the wrong combination.
 * Tightening a line to expectExactly is a deliberate edit by the owner, and is lost on regeneration.
 *
 * Where a dependent picklist is itself controlled by another, the generated spec carries a
 * dependsOn naming the controlling field's spec, so a break in the chain is reported once at its
 * source rather than repeated for every dependent below it.
 */
public class SDTPicklistDependencySpecs {

    public static List<SDTPicklistDependencySpec> all() {
        return new List<SDTPicklistDependencySpec>();
    }
}

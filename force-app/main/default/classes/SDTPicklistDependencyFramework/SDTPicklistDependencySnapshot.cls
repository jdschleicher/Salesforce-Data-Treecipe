/**
 * Plain, ConnectApi-free snapshot of a dependent picklist's org-side state.
 *
 * ConnectApi output classes are not reliably constructible in Apex, so the source
 * boundary (ISDTPicklistDependencySource) translates ConnectApi results into this
 * plain type. That keeps the validator and its tests decoupled from ConnectApi and
 * lets tests stub a source with hand-built snapshots.
 */
public class SDTPicklistDependencySnapshot {

    public String objectApiName;
    public String fieldApiName;

    /**
     * The controlling field the ORG reports for this dependent picklist. Populated
     * from describe at the source boundary; used to detect CONTROLLING_FIELD_MISMATCH.
     * May be null when the source cannot determine it.
     */
    public String controllingFieldApiName;

    /** Controlling value -> its bit index, as reported by the org. */
    public Map<String, Integer> controllerValues;

    /** Dependent value -> the controlling-value bit indexes for which it is valid. */
    public Map<String, List<Integer>> dependentValueValidFor;

    public SDTPicklistDependencySnapshot() {
        this.controllerValues = new Map<String, Integer>();
        this.dependentValueValidFor = new Map<String, List<Integer>>();
    }

    /**
     * Decodes the values valid for a controlling value.
     *
     * @return null when the org does not have the controlling value at all;
     *         an empty set when the controlling value exists but unlocks nothing;
     *         otherwise the set of dependent values whose validFor includes the
     *         controlling value's bit index.
     */
    public Set<String> valuesValidFor(String controllingValue) {

        if (controllerValues == null || !controllerValues.containsKey(controllingValue)) {
            return null;
        }

        Integer controllerIndex = controllerValues.get(controllingValue);
        Set<String> valid = new Set<String>();

        if (dependentValueValidFor != null) {
            for (String dependentValue : dependentValueValidFor.keySet()) {
                List<Integer> validForIndexes = dependentValueValidFor.get(dependentValue);
                if (validForIndexes != null && validForIndexes.contains(controllerIndex)) {
                    valid.add(dependentValue);
                }
            }
        }

        return valid;
    }

    public Set<String> controllingValues() {
        return controllerValues == null ? new Set<String>() : controllerValues.keySet();
    }
}

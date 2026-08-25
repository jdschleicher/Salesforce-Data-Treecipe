/**
 * Boundary that resolves a spec to a plain PicklistDependencySnapshot.
 *
 * Returning a plain snapshot rather than an org-API type is deliberate: it keeps the
 * validator and its tests independent of how the data was obtained, so a source can be
 * stubbed with hand-built snapshots. Production uses SchemaPicklistDependencySource.
 *
 * Implementations may throw from fetch; PicklistDependencyValidator catches per spec and
 * records a LOOKUP_ERROR rather than aborting the remaining specs.
 */
public interface IPicklistDependencySource {
    PicklistDependencySnapshot fetch(PicklistDependencySpec spec);
}

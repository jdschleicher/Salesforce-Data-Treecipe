/**
 * Boundary that resolves a spec to a plain SDTPicklistDependencySnapshot.
 *
 * Returning a plain snapshot rather than an org-API type is deliberate: it keeps the
 * validator and its tests independent of how the data was obtained, so a source can be
 * stubbed with hand-built snapshots. Production uses SDTSchemaPicklistDependencySource.
 *
 * Implementations may throw from fetch; SDTPicklistDependencyValidator catches per spec and
 * records a LOOKUP_ERROR rather than aborting the remaining specs.
 */
public interface ISDTPicklistDependencySource {
    SDTPicklistDependencySnapshot fetch(SDTPicklistDependencySpec spec);
}
